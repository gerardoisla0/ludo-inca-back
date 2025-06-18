import { Player } from './gameManager';

interface TokenState {
  position: number;
}

interface CapturedToken {
  playerId: string;
  tokenIndex: number;
}

interface MoveResult {
  success: boolean;
  capturedTokens?: CapturedToken[];
}

interface GameStateData {
  currentPlayer: number;
  tokens: { [playerId: string]: TokenState[] };
  lastDiceRoll: number | null;
  canRollAgain: boolean;
  players: Player[];
  turnTimer: NodeJS.Timeout | null;
  started: boolean;
}

export class GameState {
  private games: Map<string, GameStateData> = new Map();

  createGame(roomId: string, force: boolean = false): void {
    const initialState: GameStateData = {
      currentPlayer: 0,
      tokens: {},
      lastDiceRoll: null,
      canRollAgain: false,
      players: [],
      turnTimer: null,
      started: false
    };
    this.games.set(roomId, initialState);
  }

  addPlayer(roomId: string, player: Player): void {
    const game = this.games.get(roomId);
    if (!game) return;

    if (!game.players) {
      game.players = [];
    }

    if (!game.players.some(p => p.id === player.id)) {
      game.players.push(player);
      // Inicializar tokens para el nuevo jugador
      if (!game.tokens[player.id]) {
        game.tokens[player.id] = Array(4).fill({ position: -1 });
      }
    }
  }

  getGameState(roomId: string): GameStateData | undefined {
    return this.games.get(roomId);
  }

  rollDice(roomId: string): number {
    const game = this.games.get(roomId);
    const value = Math.floor(Math.random() * 6) + 1;
    if (game) {
      game.lastDiceRoll = value;
      game.canRollAgain = value === 6;
      console.log(`[GameState] 🎲 Jugador sacó ${value} en juego ${roomId}`);
      console.log(`[GameState] ${value === 6 ? '✨ Tiene turno extra!' : 'Siguiente turno'}`);
    }
    return value;
  }

  moveToken(roomId: string, playerId: string, tokenIndex: number, steps: number): MoveResult {
    const game = this.games.get(roomId);
    if (!game || !game.tokens || !game.tokens[playerId]) {
      console.log('[GameState] ❌ Estado del juego no válido');
      return { success: false };
    }

    const token = game.tokens[playerId][tokenIndex];
    if (!token) return { success: false };

    console.log(`[GameState] 🎯 Intentando mover ficha ${tokenIndex} del jugador ${playerId}`);
    console.log(`[GameState] Posición actual: ${token.position}, Dados: ${game.lastDiceRoll}`);

    // Si está en casa y sacó 6, puede salir
    if (token.position === -1) {
      if (game.lastDiceRoll !== 6) {
        console.log('[GameState] ❌ No puede salir sin sacar 6');
        return { success: false };
      }
      token.position = 0;
      console.log('[GameState] ✨ Ficha sale de casa!');
      
      // Verificar si hay capturas al salir de casa
      const capturedTokens = this.checkCaptures(game, playerId, tokenIndex, 0);
      return { success: true, capturedTokens };
    }

    // Movimiento normal
    const newPosition = token.position + steps;
    if (newPosition <= 52) {
      token.position = newPosition;
      console.log(`[GameState] ✅ Ficha movida a posición ${newPosition}`);
      
      // Verificar si se captura alguna ficha enemiga en la posición final
      const capturedTokens = this.checkCaptures(game, playerId, tokenIndex, newPosition);
      return { success: true, capturedTokens };
    }

    console.log('[GameState] ❌ Movimiento fuera de rango');
    return { success: false };
  }

  private checkCaptures(game: GameStateData, playerId: string, tokenIndex: number, position: number): CapturedToken[] {
    const capturedTokens: CapturedToken[] = [];
    
    // Si es un camino seguro o la posición es inválida, no capturar
    if (position < 0) return capturedTokens;
    
    // Verificar cada jugador y sus tokens
    Object.entries(game.tokens).forEach(([enemyId, enemyTokens]) => {
      // No verificar colisiones con tokens propios
      if (enemyId === playerId) return;
      
      // Verificar cada token del enemigo
      enemyTokens.forEach((enemyToken, enemyTokenIndex) => {
        // IMPORTANTE: Solo se captura si coinciden exactamente las posiciones finales
        // y no es una posición segura
        if (enemyToken.position === position && !this.isSafePosition(position)) {
          console.log(`[GameState] 🎯 Token del jugador ${playerId} capturó token ${enemyTokenIndex} del jugador ${enemyId} en la posición ${position}`);
          
          // Devolver el token a casa
          enemyToken.position = -1;
          
          // Registrar la captura
          capturedTokens.push({ playerId: enemyId, tokenIndex: enemyTokenIndex });
        }
      });
    });
    
    return capturedTokens;
  }
  
  private isSafePosition(position: number): boolean {
    // Definir las posiciones seguras en el tablero donde no se puede capturar
    const safePositions = [0, 8, 13, 21, 26, 34, 39, 47]; // Ajustar según el diseño del tablero
    return safePositions.includes(position);
  }

  nextTurn(gameId: string, io?: any): void {
    const game = this.games.get(gameId);
    if (!game) {
      console.log(`[GameState] No se encontró el juego ${gameId} para nextTurn`);
      throw new Error('Game not found');
    }

    // Si no hay jugadores, limpiar temporizador y eliminar el juego
    if (!game.players.length) {
      console.log(`[GameState] No hay jugadores en el juego ${gameId}, finalizando juego y limpiando temporizador`);
      if (game.turnTimer) {
        clearTimeout(game.turnTimer);
        game.turnTimer = null;
      }
      this.games.delete(gameId);
      return;
    }

    game.currentPlayer = (game.currentPlayer + 1) % game.players.length;
    const currentPlayerObj = game.players[game.currentPlayer];
    console.log(`[GameState] Comienza el turno de ${currentPlayerObj?.name || 'desconocido'} (${currentPlayerObj?.id}) en juego ${gameId}`);

    // Notificar al frontend del nuevo turno
    if (io) {
      io.to(gameId).emit('nextTurn', { currentPlayer: game.currentPlayer });
    }

    // Establecer nuevo temporizador
    if (game.turnTimer) {
      clearTimeout(game.turnTimer);
    }
    game.turnTimer = setTimeout(() => {
      this.nextTurn(gameId, io);
    }, 30000); // 30 segundos por turno
  }

  removePlayer(gameId: string, playerId: string): void {
    const game = this.games.get(gameId);
    if (!game) {
      return;
    }

    const index = game.players.findIndex(p => p.id === playerId);
    if (index !== -1) {
      game.players.splice(index, 1);
      delete game.tokens[playerId];
    }

    // Solo eliminar el juego si ya había comenzado (started === true) y no quedan jugadores
    if (game.players.length === 0 && game.started) {
      if (game.turnTimer) {
        clearTimeout(game.turnTimer);
        game.turnTimer = null;
      }
      this.games.delete(gameId);
      console.log(`[GameState] Juego ${gameId} eliminado porque no quedan jugadores y el juego ya había comenzado.`);
    }
    // Si la sala está en espera (started === false), NO la elimines aunque no haya jugadores
  }
}
