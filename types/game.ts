export interface Player {
  id: string;
  name: string;
  color: 'red' | 'green' | 'blue' | 'yellow';
  ready: boolean;
  turn: boolean;
}

export interface Game {
  id: string;
  players: Player[];
  currentTurn: number;
  diceValue: number;
  board: {
    size: number;
    cells: number[][];
  };
  tokens: {
    [key: string]: {
      position: number;
      inHome: boolean;
      inFinalPath: boolean;
    }[];
  };
}

export interface GameRoom {
  id: string;
  game: Game;
  players: Player[];
  maxPlayers: number;
  started: boolean;
}
