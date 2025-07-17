import express, { Request, Response } from 'express';
import { Server, Socket } from 'socket.io';
import http from 'http';
import { GameManager } from './game/gameManager';
import { GameState } from './game/gameState';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://192.168.18.34:3000", // URL del frontend
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

  // Esperar confirmación de animación antes de pasar turno
  socket.on('moveAnimationDone', (data: { tokenId: string }) => {
    // Buscar la sala del jugador
    const roomId = Object.keys(socket.rooms).find(room => room !== socket.id);
    if (!roomId) return;
    const gameStateData = gameState.getGameState(roomId);
    const room = gameManager.getRoom(roomId);
    if (!gameStateData || !room) return;

    // Verificar que sea el turno del jugador
    const currentPlayer = room.players[gameStateData.currentPlayer];
    if (currentPlayer.id !== socket.id) {
      console.log('❌ moveAnimationDone: No es el turno de este jugador');
      return;
    }

    // Avanzar turno normalmente (como en endTurn)
    const nextPlayerIndex = (gameStateData.currentPlayer + 1) % room.players.length;
    const nextPlayer = room.players[nextPlayerIndex];
    gameStateData.currentPlayer = nextPlayerIndex;

    io.to(roomId).emit('nextTurn', {
      currentPlayer: nextPlayer.id,
      playerName: nextPlayer.name,
      color: nextPlayer.color,
      canRollAgain: false
    });
  });
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
      // Si la sala no existe o ya fue eliminada, redirigir al home
      const room = gameManager.getRoom(roomId);
      if (!room || room.state === 'finished') {
        console.log('⛔ Sala no existe o ya terminó, redirigiendo al home:', roomId);
        socket.emit('redirectHome', { message: 'La sala ya no está disponible.' });
        return;
      }
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
    const gameStateData = gameState.getGameState(roomId);
    const room = gameManager.getRoom(roomId);
    
    // Verificar que sea el turno del jugador
    if (!gameStateData || !room) return;
    const currentPlayer = room.players[gameStateData.currentPlayer];
    if (currentPlayer.id !== socket.id) {
      console.log('❌ No es el turno de este jugador');
      return;
    }

    const diceValue = gameState.rollDice(roomId);
    
    // Enviar resultado a todos los jugadores
    io.to(roomId).emit('diceRolled', { 
      value: diceValue,
      playerId: socket.id,
      canRollAgain: diceValue === 6
    });
    
    // Si sacó 6, revisar si el jugador tiene opciones para mover
    if (diceValue === 6) {
      const playerTokensState = gameStateData.tokens[socket.id];
      if (playerTokensState) {
        // Verificar si hay al menos una ficha en casa y una en el tablero
        const hasTokenAtHome = playerTokensState.some(t => t.position === -1);
        const hasTokenOnBoard = playerTokensState.some(t => t.position >= 0 && t.position < 52);
        
        if (hasTokenAtHome && hasTokenOnBoard) {
          // Avisar al cliente que tiene múltiples opciones
          socket.emit('multipleOptions', {
            message: 'Puedes sacar una ficha o mover una existente'
          });
        }
      }
    }
  });

  // Evento para mover un token
  socket.on('moveToken', (data: { 
    roomId: string; 
    playerId: string; 
    tokenId: string; 
    steps: number;
    isInitialMove?: boolean 
  }) => {
    const { roomId, playerId, tokenId, steps, isInitialMove } = data;
    const gameStateData = gameState.getGameState(roomId);
    const room = gameManager.getRoom(roomId);

    if (!gameStateData || !room) {
      console.log('❌ Estado del juego no encontrado:', roomId);
      return;
    }

    // Verificar que el juego esté iniciado y tenga estado válido
    if (!gameStateData.tokens || !gameStateData.tokens[playerId]) {
      console.log('❌ Estado de fichas no inicializado:', roomId);
      return;
    }

    const currentPlayer = room.players[gameStateData.currentPlayer];
    if (currentPlayer.id !== socket.id) {
      console.log('❌ No es el turno de este jugador');
      return;
    }

    // Verificar si es un movimiento inicial válido
    if (isInitialMove) {
      if (gameStateData.lastDiceRoll !== 6) {
        console.log('❌ No se puede sacar ficha sin haber sacado 6');
        socket.emit('moveInvalid', {
          message: 'Necesitas sacar 6 para sacar una ficha',
          tokenId,
          playerId
        });
        return;
      }
    }

    const result = gameState.moveToken(roomId, playerId, tokenId, steps);
    
    if (result.success) {
      // Emitir el movimiento a todos los jugadores
      const token = gameStateData.tokens[playerId].find(tk => tk.id === tokenId);
      io.to(roomId).emit('tokenMoved', {
        playerId,
        tokenId,
        steps,
        isInitialMove,
        position: token ? token.position : -1,
        capturedTokens: result.capturedTokens,
        reachedEnd: result.reachedEnd
      });

      // Si el jugador ganó, notificar a todos
      if (result.hasWon) {
        io.to(roomId).emit('playerWon', {
          playerId,
          playerName: room.players.find(p => p.id === playerId)?.name || 'Unknown'
        });
        // No terminar el turno aquí para permitir celebración
        return;
      }

      // Si capturó una ficha, emitir el evento de captura
      if (result.capturedTokens && result.capturedTokens.length > 0) {
        for (const captured of result.capturedTokens) {
          io.to(roomId).emit('tokenCaptured', {
            playerId: captured.playerId,
            tokenId: captured.tokenId
          });
        }
      }

      // Manejo de turnos mejorado
      if (gameStateData.lastDiceRoll === 6) {
        // Si sacó 6, mantener el turno y permitir otro lanzamiento
        io.to(roomId).emit('nextTurn', {
          currentPlayer: currentPlayer.id,
          playerName: currentPlayer.name,
          color: currentPlayer.color,
          canRollAgain: true,
          message: '¡Sacaste 6! Tira de nuevo'
        });
        return; // Importante: retornar aquí para no cambiar de turno
      }

      // Si no sacó 6, pasar al siguiente jugador
      const nextPlayerIndex = (gameStateData.currentPlayer + 1) % room.players.length;
      const nextPlayer = room.players[nextPlayerIndex];
      gameStateData.currentPlayer = nextPlayerIndex;

      io.to(roomId).emit('nextTurn', {
        currentPlayer: nextPlayer.id,
        playerName: nextPlayer.name,
        color: nextPlayer.color,
        canRollAgain: false
      });
    } else {
      console.log('❌ Movimiento no válido');
      
      // Si es un error por necesitar un número exacto para la meta
      if (result.needsExactRoll) {
        socket.emit('moveInvalid', {
          message: 'Necesitas un número exacto para llegar a la meta',
          tokenId,
          playerId,
          needsExactRoll: true
        });
        
        // Pasar automáticamente al siguiente jugador
        const nextPlayerIndex = (gameStateData.currentPlayer + 1) % room.players.length;
        const nextPlayer = room.players[nextPlayerIndex];
        gameStateData.currentPlayer = nextPlayerIndex;

        io.to(roomId).emit('nextTurn', {
          currentPlayer: nextPlayer.id,
          playerName: nextPlayer.name,
          color: nextPlayer.color,
          canRollAgain: false,
          automaticSkip: true  // Indicador de que se saltó automáticamente
        });
      } else {
        // Otros errores de movimiento
        socket.emit('moveInvalid', {
          message: 'Movimiento no válido',
          tokenId,
          playerId
        });
      }
    }
  });

  // Añadimos un nuevo evento para saltar turno automáticamente
  socket.on('skipTurn', (data: { roomId: string }) => {
    const gameStateData = gameState.getGameState(data.roomId);
    const room = gameManager.getRoom(data.roomId);
    
    if (!gameStateData || !room) return;
    
    // Verificar que sea el turno del jugador
    const currentPlayer = room.players[gameStateData.currentPlayer];
    if (currentPlayer.id !== socket.id) {
      console.log('❌ No es el turno de este jugador');
      return;
    }
    
    // Pasar al siguiente jugador
    const nextPlayerIndex = (gameStateData.currentPlayer + 1) % room.players.length;
    const nextPlayer = room.players[nextPlayerIndex];
    gameStateData.currentPlayer = nextPlayerIndex;

    io.to(data.roomId).emit('nextTurn', {
      currentPlayer: nextPlayer.id,
      playerName: nextPlayer.name,
      color: nextPlayer.color,
      canRollAgain: false
    });
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
      try {
        // Forzar la creación/reinicio del estado del juego
        gameState.createGame(roomId, true);
        
        // Inicializar los tokens para cada jugador
        room.players.forEach(player => {
          gameState.addPlayer(roomId, player);
        });

        const gameStateData = gameState.getGameState(roomId);
        if (gameStateData) {
          // Inicializar tokens para todos los jugadores
          room.players.forEach(player => {
            if (!gameStateData.tokens[player.id]) {
              gameStateData.tokens[player.id] = Array(4).fill({ position: -1 });
            }
          });
          
          // Configurar el primer turno
          const firstPlayer = room.players[0];
          gameStateData.currentPlayer = 0;

          // Emitir eventos
          io.to(roomId).emit('gameStarted');
          io.to(roomId).emit('gameState', gameStateData);
          io.to(roomId).emit('nextTurn', {
            currentPlayer: firstPlayer.id,
            playerName: firstPlayer.name,
            color: firstPlayer.color,
            canRollAgain: false
          });
        }
      } catch (error) {
        console.error('❌ Error al inicializar estado del juego:', error);
        return;
      }
    }
  });

  // Manejo de turnos
  socket.on('endTurn', (data: { roomId: string }) => {
    const room = gameManager.getRoom(data.roomId);
    if (!room) return;

    const currentPlayerIndex = room.players.findIndex(p => p.id === socket.id);
    if (currentPlayerIndex === -1) return;

    // Solo permitir terminar el turno si es el turno del jugador
    const gameStateData = gameState.getGameState(data.roomId);
    if (!gameStateData || gameStateData.currentPlayer !== currentPlayerIndex) {
      return;
    }

    const nextPlayerIndex = (currentPlayerIndex + 1) % room.players.length;
    const nextPlayer = room.players[nextPlayerIndex];

    // Actualizar el estado del juego
    gameStateData.currentPlayer = nextPlayerIndex;

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
      // Si ya no quedan jugadores en la sala, eliminar la sala y el estado del juego
      const players = gameManager.getRoomPlayers(roomId);
      if (players.length === 0) {
        console.log(`🗑️ Eliminando sala y estado de juego por desconexión total: ${roomId}`);
        gameManager.deleteRoom(roomId);
        gameState.deleteGame(roomId);
      } else {
        io.to(roomId).emit('roomUpdate', players);
        io.to(roomId).emit('gameState', gameState.getGameState(roomId));
      }
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
