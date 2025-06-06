import { Socket } from 'socket.io';

export interface Player {
  id: string;
  name: string;
  color: 'red' | 'green' | 'blue' | 'yellow';
  ready: boolean;
}

export interface GameRoom {
  id: string;
  players: Player[];
  maxPlayers: number;
  started: boolean;
  // Agrega estado de la sala
  state?: 'lobby' | 'playing' | 'finished';
}

export class GameManager {
  private rooms: Map<string, GameRoom> = new Map();
  private playerColors: ('red' | 'green' | 'blue' | 'yellow')[] = ['red', 'green', 'blue', 'yellow'];

  constructor() {
    // Inicializar la sala por defecto
    this.createRoom('default');
  }

  createRoom(roomId: string): void {
    if (this.rooms.has(roomId)) {
      throw new Error('Room already exists');
    }

    const room: GameRoom = {
      id: roomId,
      players: [],
      maxPlayers: 4,
      started: false,
      state: 'lobby'
    };

    this.rooms.set(roomId, room);
  }

  joinRoom(socket: Socket, roomId: string, playerName: string): Player | null {
    const room = this.rooms.get(roomId);
    if (!room) {
      // Ya no se crea la sala aquí, solo se permite unirse si existe
      return null;
    }

    if (room.players.length >= room.maxPlayers) {
      return null;
    }

    // Asignar color disponible
    const availableColors = this.playerColors.filter(color => 
      !room.players.some(player => player.color === color)
    );

    if (availableColors.length === 0) {
      return null;
    }

    const player: Player = {
      id: socket.id,
      name: playerName,
      color: availableColors[0],
      ready: false
    };

    room.players.push(player);
    socket.join(roomId);

    return player;
  }

  leaveRoom(socket: Socket): void {
    for (const [roomId, room] of this.rooms.entries()) {
      const index = room.players.findIndex(player => player.id === socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        socket.leave(roomId);
        break;
      }
    }
  }

  getRoom(roomId: string): GameRoom | null {
    return this.rooms.get(roomId) || null;
  }

  startGame(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    // Permitir iniciar con al menos 1 jugador
    if (room.players.length < 1) {
      return false;
    }

    room.started = true;
    room.state = 'playing';
    return true;
  }

  finishGame(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.state = 'finished';
    }
  }

  getRoomState(roomId: string): string | undefined {
    const room = this.rooms.get(roomId);
    return room?.state;
  }

  isPlayerReady(socketId: string, ready: boolean): boolean {
    for (const room of this.rooms.values()) {
      const player = room.players.find(p => p.id === socketId);
      if (player) {
        player.ready = ready;
        return true;
      }
    }
    return false;
  }

  getRoomPlayers(roomId: string): Player[] {
    const room = this.rooms.get(roomId);
    return room ? room.players : [];
  }

  canStartGame(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    // Permitir iniciar el juego con cualquier cantidad de jugadores (al menos 1)
    return room.players.length >= 1;
  }
}
