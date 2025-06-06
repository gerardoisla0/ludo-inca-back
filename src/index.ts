import express, { Request, Response } from 'express';
import { Server, Socket } from 'socket.io';
import http from 'http';
import { GameManager } from './game/gameManager';
import { GameState } from './game/gameState';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", // URL del frontend
    methods: ["GET", "POST"]
  }
});

// Inicializar managers
const gameManager = new GameManager();
const gameState = new GameState();

// Middleware
app.use(express.json());

// Rutas
app.get('/', (req: Request, res: Response) => {
  res.send('Ludo Inca Backend');
});

// Socket.IO
io.on('connection', (socket: Socket) => {
  console.log('Nuevo cliente conectado:', socket.id);

  socket.on('createRoom', (data: { roomId: string }) => {
    console.log('📝 Creando sala:', data.roomId);
    try {
      gameManager.createRoom(data.roomId);
      socket.emit('roomCreated', { 
        roomId: data.roomId, 
        success: true,
        socketId: socket.id 
      });
      console.log('✅ Sala creada:', data.roomId);
    } catch (err) {
      console.error('❌ Error al crear sala:', err);
      socket.emit('roomCreated', { 
        roomId: data.roomId, 
        success: false, 
        message: 'La sala ya existe',
        socketId: socket.id
      });
    }
  });

  socket.on('joinRoom', (data: { roomId: string; name: string }) => {
    console.log('🔄 Intentando unir a sala:', data);
    const { roomId, name } = data;
    
    try {
      const player = gameManager.joinRoom(socket, roomId, name);
      if (player) {
        socket.join(roomId);
        
        if (!gameState.getGameState(roomId)) {
          gameState.createGame(roomId);
        }
        gameState.addPlayer(roomId, player);
        
        console.log('✅ Jugador unido:', player);
        socket.emit('joinSuccess', { player, roomId });
        
        // Enviar actualización a todos en la sala
        const players = gameManager.getRoomPlayers(roomId);
        io.to(roomId).emit('roomUpdate', players);
      }
    } catch (error) {
      console.error('❌ Error al unir jugador:', error);
      socket.emit('joinFailed', { message: 'Error al unirse a la sala' });
    }
  });

  socket.on('getRoomPlayers', (roomId: string) => {
    console.log('📝 Solicitud de jugadores para sala:', roomId);
    const players = gameManager.getRoomPlayers(roomId);
    console.log('📝 Enviando jugadores:', players);
    socket.emit('roomUpdate', players);
  });

  // Evento para indicar que un jugador está listo
  socket.on('playerReady', (ready: boolean) => {
    console.log(`[playerReady] socket: ${socket.id}, ready:`, ready);
    gameManager.isPlayerReady(socket.id, ready);
    const roomId = Object.keys(socket.rooms).find(room => room !== socket.id);
    if (roomId) {
      io.to(roomId).emit('roomUpdate', gameManager.getRoomPlayers(roomId));
      
      // Verificar si se puede comenzar el juego
      if (gameManager.canStartGame(roomId)) {
        gameManager.startGame(roomId);
        io.to(roomId).emit('gameStarted');
        gameState.nextTurn(roomId, io);
      }
    }
  });

  // Evento para tirar el dado
  socket.on('rollDice', (roomId: string) => {
    console.log(`[rollDice] socket: ${socket.id}, roomId:`, roomId);
    const diceValue = gameState.rollDice(roomId);
    io.to(roomId).emit('diceRolled', { value: diceValue });
  });

  // Evento para mover un token
  socket.on('moveToken', (data: { roomId: string; playerId: string; tokenIndex: number; steps: number }) => {
    console.log(`[moveToken] socket: ${socket.id}, data:`, data);
    const { roomId, playerId, tokenIndex, steps } = data;
    const success = gameState.moveToken(roomId, playerId, tokenIndex, steps);
    
    if (success) {
      io.to(roomId).emit('tokenMoved', {
        playerId,
        tokenIndex,
        position: gameState.getGameState(roomId)?.tokens[playerId][tokenIndex].position || -1
      });
      
      // Pasar al siguiente turno
      gameState.nextTurn(roomId, io);
      io.to(roomId).emit('nextTurn', {
        currentPlayer: gameState.getGameState(roomId)?.currentPlayer || 0
      });
    }
  });

  // Evento para iniciar el juego explícitamente
  socket.on('startGame', (roomId: string) => {
    console.log('🎮 Starting game for room:', roomId);
    const room = gameManager.getRoom(roomId);
    
    if (!room || !room.players.length) {
      console.error('❌ No se puede iniciar el juego: sala no existe o está vacía');
      return;
    }

    const success = gameManager.startGame(roomId);
    if (success) {
      // Asegurar que el estado del juego esté creado y actualizado
      if (!gameState.getGameState(roomId)) {
        gameState.createGame(roomId);
        room.players.forEach(player => {
          gameState.addPlayer(roomId, player);
        });
      }

      console.log('✅ Juego iniciado para sala:', roomId);
      io.to(roomId).emit('gameStarted');

      // Configurar el primer turno
      const firstPlayer = room.players[0];
      console.log('🎲 Primer turno para:', firstPlayer.name);
      
      const gameStateData = gameState.getGameState(roomId);
      if (gameStateData) {
        // Usar índice 0 para el primer jugador
        gameStateData.currentPlayer = 0;
        
        // Emitir el estado inicial del juego y el primer turno
        io.to(roomId).emit('gameState', gameStateData);
        io.to(roomId).emit('nextTurn', {
          currentPlayer: firstPlayer.id,
          playerName: firstPlayer.name,
          color: firstPlayer.color
        });
      }
    } else {
      console.error('❌ Error al iniciar el juego para sala:', roomId);
    }
  });

  // Manejo de turnos
  socket.on('endTurn', (data: { roomId: string }) => {
    const room = gameManager.getRoom(data.roomId);
    if (!room) return;

    const currentPlayerIndex = room.players.findIndex(p => p.id === socket.id);
    if (currentPlayerIndex === -1) return;

    const nextPlayerIndex = (currentPlayerIndex + 1) % room.players.length;
    const nextPlayer = room.players[nextPlayerIndex];

    io.to(data.roomId).emit('nextTurn', {
      currentPlayer: nextPlayer.id,
      playerName: nextPlayer.name,
      color: nextPlayer.color
    });
  });

  // Puedes emitir el estado de la sala cuando alguien lo solicite
  socket.on('getRoomState', (roomId: string) => {
    console.log('📝 Solicitud de estado de sala:', roomId);
    const state = gameManager.getRoomState(roomId);
    const gameStateData = gameState.getGameState(roomId);
    const room = gameManager.getRoom(roomId);
    
    if (room && gameStateData) {
      console.log('📝 Enviando estado completo:', { state, gameState: gameStateData });
      socket.emit('roomState', { 
        roomId, 
        state: 'playing',
        gameState: gameStateData,
        currentPlayer: {
          id: room.players[gameStateData.currentPlayer].id,
          name: room.players[gameStateData.currentPlayer].name,
          color: room.players[gameStateData.currentPlayer].color
        }
      });
    }
  });

  // Evento para desconexión
  socket.on('disconnect', () => {
    console.log(`[disconnect] socket: ${socket.id}`);
    const roomId = Object.keys(socket.rooms).find(room => room !== socket.id);
    if (roomId) {
      gameManager.leaveRoom(socket);
      gameState.removePlayer(roomId, socket.id);
      io.to(roomId).emit('roomUpdate', gameManager.getRoomPlayers(roomId));
      io.to(roomId).emit('gameState', gameState.getGameState(roomId));
    }
    console.log('Cliente desconectado:', socket.id);
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});

// El backend ya está listo para recibir conexiones Socket.IO y manejar eventos de juego.
// Asegúrate de que el frontend use los mismos nombres de eventos y estructura de datos.
