import { Player } from './gameManager';

import { v4 as uuidv4 } from 'uuid';

interface TokenState {
  id: string;
  position: number;
}

interface CapturedToken {
  playerId: string;
  tokenId: string;
}

interface MoveResult {
  success: boolean;
  capturedTokens?: CapturedToken[];
  reachedEnd?: boolean;
  hasWon?: boolean;
  needsExactRoll?: boolean;  // Nueva propiedad para indicar que necesita un número exacto
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

  public deleteGame(roomId: string): void {
    this.games.delete(roomId);
  }

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
        // Cada ficha debe ser un objeto independiente y tener un UUID
        game.tokens[player.id] = Array(4).fill(0).map(() => ({ id: uuidv4(), position: -1 }));
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

  moveToken(roomId: string, playerId: string, tokenId: string, steps: number): MoveResult {
    const game = this.games.get(roomId);
    if (!game || !game.tokens || !game.tokens[playerId]) {
      console.log('[GameState] ❌ Estado del juego no válido');
      return { success: false };
    }

    // Helper para encontrar el índice de la ficha por UUID
    const allTokens = game.tokens[playerId];
    const tokenIndex = allTokens.findIndex(tk => tk.id === tokenId);
    if (tokenIndex === -1) {
      console.log(`[GameState] ❌ Token no encontrado: id ${tokenId}`);
      return { success: false };
    }
    const token = allTokens[tokenIndex];

    // Log de todas las posiciones de las fichas del jugador antes de mover
    console.log(`[GameState] 🧩 Estado de todas las fichas del jugador ${playerId}:`);
    allTokens.forEach((tk, idx) => {
      console.log(`  - Ficha ${idx} (id: ${tk.id}): posición ${tk.position}`);
    });

    console.log(`[GameState] 🎯 Intentando mover ficha id ${tokenId} del jugador ${playerId}`);
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
      const capturedTokens = this.checkCaptures(game, playerId, tokenId, 0);
      return { success: true, capturedTokens };
    }

    // Constantes para gestionar el camino
    const PERIMETER_END = 51;  // Última posición del perímetro
    const FINAL_PATH_START = 52; // Inicio del camino final
    const FINAL_PATH_END = 57;  // Final del camino (posición de victoria)

    // Si ya está en la posición final, no se puede mover más
    if (token.position === FINAL_PATH_END) {
      console.log('[GameState] ❌ Ficha ya está en la posición final, no puede moverse más');
      return { success: false };
    }

    // Calcular la nueva posición SOLO para la ficha seleccionada
    let newPosition = token.position + steps;

    // Gestionar el paso del perímetro al camino final SOLO para esta ficha
    if (token.position <= PERIMETER_END && newPosition > PERIMETER_END) {
      // Si la ficha está en el perímetro y pasaría al camino final
      if (newPosition > FINAL_PATH_END) {
        // Si se pasaría del final, rebote SOLO para esta ficha
        const excess = newPosition - FINAL_PATH_END;
        newPosition = FINAL_PATH_END - excess;
        // Si el rebote la deja fuera del rango válido, bloquear movimiento
        if (newPosition < FINAL_PATH_START) {
          console.log('[GameState] ❌ Movimiento excede la posición final del camino (rebote fuera de rango)');
          return {
            success: false,
            needsExactRoll: true
          };
        }
        console.log('[GameState] 🔄 Rebotando en el final:', newPosition);
      }
    }
    // Si ya está en el camino final SOLO para esta ficha
    else if (token.position >= FINAL_PATH_START) {
      // Verificar que no se pase del final SOLO para esta ficha
      if (newPosition > FINAL_PATH_END) {
        console.log('[GameState] ❌ Movimiento excede la posición final del camino');
        return { 
          success: false,
          needsExactRoll: true  // Indicar que necesita un número exacto
        };
      }
    }

    // Si llega exactamente a la posición final
    if (newPosition === FINAL_PATH_END) {
      token.position = newPosition;
      console.log('[GameState] 🏆 Ficha ha llegado a la posición final!');
      // Solo se gana si las 4 fichas están en la posición final
      const hasWon = this.checkWinCondition(game, playerId);
      if (hasWon) {
        console.log(`[GameState] 🎉 El jugador ${playerId} ha ganado! (las 4 fichas en el final)`);
        return { success: true, hasWon: true };
      }
      // Si no, solo reportar que una ficha llegó al final
      return { success: true, reachedEnd: true };
    }

    // Movimiento normal
    token.position = newPosition;
    console.log(`[GameState] ✅ Ficha movida a posición ${newPosition}`);
    
    // Verificar capturas solo en el perímetro, no en camino final
    const capturedTokens: CapturedToken[] = [];
    if (newPosition <= PERIMETER_END) {
      const captures = this.checkCaptures(game, playerId, tokenId, newPosition);
      if (captures && captures.length > 0) {
        captures.forEach(capture => capturedTokens.push(capture));
      }
    }
    
    return { success: true, capturedTokens };
  }

  // Método para verificar si todas las fichas del jugador han llegado a la posición final
  private checkWinCondition(game: GameStateData, playerId: string): boolean {
    const playerTokens = game.tokens[playerId];
    if (!playerTokens) return false;
    
    // Verificar si todas las fichas están en la posición final (57)
    const FINAL_POSITION = 57;  // Final del camino
    return playerTokens.every(token => token.position === FINAL_POSITION);
  }

  private checkCaptures(game: GameStateData, playerId: string, tokenId: string, position: number): CapturedToken[] {
    const capturedTokens: CapturedToken[] = [];
    
    // Si es un camino seguro o la posición es inválida, no capturar
    if (position < 0) return capturedTokens;
    
    // Verificar cada jugador y sus tokens
    Object.entries(game.tokens).forEach(([enemyId, enemyTokens]) => {
      // No verificar colisiones con tokens propios
      if (enemyId === playerId) return;
      
      // Verificar cada token del enemigo
      enemyTokens.forEach((enemyToken) => {
        // IMPORTANTE: Solo se captura si coinciden exactamente las posiciones finales
        // y no es una posición segura
        if (enemyToken.position === position && !this.isSafePosition(position)) {
          console.log(`[GameState] 🎯 Token del jugador ${playerId} capturó token id ${enemyToken.id} del jugador ${enemyId} en la posición ${position}`);
          
          // Devolver el token a casa
          enemyToken.position = -1;
          
          // Registrar la captura
          capturedTokens.push({ playerId: enemyId, tokenId: enemyToken.id });
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

  // Método para verificar si un jugador puede hacer algún movimiento válido
  canMakeValidMove(roomId: string, playerId: string, diceValue: number): boolean {
    const game = this.games.get(roomId);
    if (!game || !game.tokens || !game.tokens[playerId]) return false;

    const playerTokens = game.tokens[playerId];
    
    // Comprobar cada token del jugador
    for (let i = 0; i < playerTokens.length; i++) {
      const token = playerTokens[i];
      
      // Si está en casa y sacó un 6, puede moverse
      if (token.position === -1 && diceValue === 6) return true;
      
      // Si no está en casa ni en la posición final
      if (token.position >= 0 && token.position < this.FINAL_PATH_END) {
        // Si está en camino final, verificar que no se pase
        if (token.position >= this.FINAL_PATH_START) {
          if (token.position + diceValue <= this.FINAL_PATH_END) return true;
        } else {
          // Si está en perímetro normal, siempre puede moverse
          return true;
        }
      }
    }
    
    // Si llegamos aquí, no hay movimiento válido
    return false;
  }

  private readonly PERIMETER_END = 51;
  private readonly FINAL_PATH_START = 52;
  private readonly FINAL_PATH_END = 57;
}
