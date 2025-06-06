import { Player } from './gameManager';

export interface Token {
  id: string;
  position: number;
  inHome: boolean;
  inFinalPath: boolean;
}

export interface Game {
  id: string;
  players: Player[];
  currentPlayer: number;
  diceValue: number;
  tokens: {
    [playerId: string]: Token[];
  };
  board: {
    size: number;
    cells: number[][];
  };
  started: boolean;
  turnTimer: NodeJS.Timeout | null;
}

export class GameState {
  private games: Map<string, Game> = new Map();
  private readonly BOARD_SIZE = 14;
  private readonly TOKENS_PER_PLAYER = 4;

  constructor() {
    // Inicializar el tablero
    this.initializeBoard();
  }

  private initializeBoard(): void {
    // Crear el tablero 14x14
    const board: number[][] = Array(this.BOARD_SIZE)
      .fill(0)
      .map(() => Array(this.BOARD_SIZE).fill(0));

    // Configurar las casillas especiales
    // (Esta es una implementación básica, puedes ajustar según tus necesidades)
    // Casillas de inicio
    board[2][2] = 1; // Verde
    board[2][12] = 1; // Amarillo
    board[12][12] = 1; // Azul
    board[12][2] = 1; // Rojo

    // Casillas de meta
    board[7][7] = 2;

    // Casillas de camino final
    // (Esto es solo un ejemplo, ajusta según tu diseño del juego)
    for (let i = 0; i < 6; i++) {
      board[7][7 + i] = 3; // Verde
      board[7 + i][7] = 3; // Amarillo
      board[7][7 - i] = 3; // Azul
      board[7 - i][7] = 3; // Rojo
    }
  }

  createGame(gameId: string): void {
    if (this.games.has(gameId)) {
      throw new Error('Game already exists');
    }

    const game: Game = {
      id: gameId,
      players: [],
      currentPlayer: 0,
      diceValue: 1,
      tokens: {},
      board: {
        size: this.BOARD_SIZE,
        cells: Array(this.BOARD_SIZE)
          .fill(0)
          .map(() => Array(this.BOARD_SIZE).fill(0))
      },
      started: false,
      turnTimer: null
    };

    this.games.set(gameId, game);
    console.log(`[GameState] Juego creado: ${gameId}`);
  }

  addPlayer(gameId: string, player: Player): void {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    // Evitar agregar el mismo jugador dos veces
    if (!game.players.some(p => p.id === player.id)) {
      game.players.push(player);
      game.tokens[player.id] = Array(this.TOKENS_PER_PLAYER).fill(0).map(() => ({
        id: `${player.id}-${Date.now()}`,
        position: -1, // -1 significa que está en casa
        inHome: true,
        inFinalPath: false
      }));
      console.log(`[GameState] Jugador agregado: ${player.name} (${player.id}) a juego ${gameId}`);
    }
  }

  rollDice(gameId: string): number {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    game.diceValue = Math.floor(Math.random() * 6) + 1;
    console.log(`[GameState] Dado lanzado en juego ${gameId}: valor = ${game.diceValue}`);
    return game.diceValue;
  }

  moveToken(gameId: string, playerId: string, tokenIndex: number, steps: number): boolean {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    if (!game.started) {
      console.log(`[GameState] No se puede mover ficha, el juego ${gameId} no ha comenzado`);
      return false;
    }

    if (game.currentPlayer !== game.players.findIndex(p => p.id === playerId)) {
      console.log(`[GameState] No es el turno del jugador ${playerId} en juego ${gameId}`);
      return false;
    }

    const tokens = game.tokens[playerId];
    if (!tokens || tokenIndex < 0 || tokenIndex >= tokens.length) {
      return false;
    }

    const token = tokens[tokenIndex];
    if (token.inHome && steps !== 6) {
      console.log(`[GameState] El token está en casa y no se sacó un 6 en juego ${gameId}`);
      return false;
    }

    // Lógica de movimiento
    if (token.inHome) {
      token.position = 0;
      token.inHome = false;
    } else {
      token.position += steps;
      // Verificar si entra al camino final
      if (token.position >= 52) { // 52 es el número de casillas antes del camino final
        token.inFinalPath = true;
        token.position = token.position - 52;
      }
    }

    // Verificar si llega a la meta
    if (token.inFinalPath && token.position >= 6) {
      token.position = -2; // -2 significa que llegó a la meta
      console.log(`[GameState] Token llegó a la meta en juego ${gameId}`);
    }

    console.log(`[GameState] Token movido en juego ${gameId}: player=${playerId}, tokenIndex=${tokenIndex}, steps=${steps}`);
    return true;
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

  getGameState(gameId: string): Game | null {
    return this.games.get(gameId) || null;
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
