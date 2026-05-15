import { Server, Socket } from 'socket.io';
import prisma from '../lib/prisma';
import { GameMode, GameStatus } from '@prisma/client';

interface GameRoomState {
  sessionId: string;
  drawnNumbers: number[];
  currentBall: number | null;
  status: GameStatus;
  countdown: number;
  timer: NodeJS.Timeout | null;
  ballTimer: NodeJS.Timeout | null;
}

const gameRooms = new Map<string, GameRoomState>();

export const gameSocketHandler = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    console.log(`🔌 Player connected: ${socket.id}`);

    // Join a game room
    socket.on('game:join', async (sessionId: string) => {
      const session = await prisma.gameSession.findUnique({
        where: { id: sessionId },
        include: {
          cards: true,
        },
      });

      if (!session) {
        return socket.emit('error', { message: 'Game session not found' });
      }

      socket.join(`game:${sessionId}`);

      // Send current state to joining player
      const room = gameRooms.get(sessionId);
      socket.emit('game:state', {
        session,
        drawnNumbers: room?.drawnNumbers || [],
        currentBall: room?.currentBall,
        countdown: room?.countdown,
      });
    });

    // Claim bingo
    socket.on('game:claim', async ({ sessionId, cardId }) => {
      const room = gameRooms.get(sessionId);
      if (!room) return;

      const card = await prisma.bingoCard.findUnique({
        where: { id: cardId },
      });

      if (!card || card.sessionId !== sessionId) {
        return socket.emit('error', { message: 'Invalid card' });
      }

      // Server-side validation (NEVER trust client)
      const pattern = await prisma.gamePattern.findFirst({
        where: { id: (await prisma.gameSession.findUnique({ where: { id: sessionId } }))?.patternId },
      });

      if (!pattern) return;

      const isValid = validateBingo(card, room.drawnNumbers, pattern.grid as boolean[][]);

      if (isValid) {
        // Player won!
        await prisma.$transaction(async (tx) => {
          await tx.bingoCard.update({
            where: { id: cardId },
            data: { isWinner: true },
          });

          const user = await tx.user.findUnique({ where: { id: card.userId } });

          await tx.gameSession.update({
            where: { id: sessionId },
            data: {
              status: 'ENDED',
              winnerId: card.userId,
              winnerName: user?.fullName || 'Unknown',
              winnerPrize: (await tx.gameSession.findUnique({ where: { id: sessionId } }))?.prizePotBirr || 0,
              endedAt: new Date(),
            },
          });
        });

        // Broadcast winner
        io.to(`game:${sessionId}`).emit('game:winner', {
          cardId,
          message: `🎉 BINGO! Player won!`,
        });

        // Clean up timers
        cleanupRoom(sessionId);
      } else {
        socket.emit('error', { message: 'Invalid bingo claim' });
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`🔌 Player disconnected: ${socket.id}`);
    });
  });

  // Expose room management for admin routes
  (io as any).startGameSession = async (sessionId: string) => {
    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
      include: { cards: true },
    });

    if (!session) return;

    const purchaseWindowSecs = session.purchaseWindowSecs || 120;

    // Create room state
    gameRooms.set(sessionId, {
      sessionId,
      drawnNumbers: [],
      currentBall: null,
      status: 'PURCHASE_OPEN',
      countdown: purchaseWindowSecs,
      timer: null,
      ballTimer: null,
    });

    // Broadcast to all players in the room
    io.to(`game:${sessionId}`).emit('game:state', {
      session,
      drawnNumbers: [],
      currentBall: null,
      countdown: purchaseWindowSecs,
    });

    // Start purchase countdown
    const room = gameRooms.get(sessionId)!;
    room.timer = setInterval(async () => {
      room.countdown--;

      // Broadcast countdown
      io.to(`game:${sessionId}`).emit('game:countdown', {
        remaining: room.countdown,
        status: 'PURCHASE_OPEN',
      });

      if (room.countdown <= 0) {
        clearInterval(room.timer!);
        room.status = 'IN_PROGRESS';
        room.drawnNumbers = [];

        // Update database
        await prisma.gameSession.update({
          where: { id: sessionId },
          data: {
            status: 'IN_PROGRESS',
            startedAt: new Date(),
          },
        });

        io.to(`game:${sessionId}`).emit('game:started', {
          message: '🎱 Game started! Good luck!',
        });

        // Start ball drawing
        startBallDraw(sessionId);
      }
    }, 1000);
  };

  const startBallDraw = async (sessionId: string) => {
    const room = gameRooms.get(sessionId);
    if (!room) return;

    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) return;

    const maxBalls = session.gameMode === 'FAST_BINGO' ? 30 : 75;
    const interval = (session.drawIntervalSecs || 4) * 1000;

    room.ballTimer = setInterval(async () => {
      if (room.drawnNumbers.length >= maxBalls) {
        clearInterval(room.ballTimer!);

        // All balls drawn, end game
        await prisma.gameSession.update({
          where: { id: sessionId },
          data: { status: 'ENDED', endedAt: new Date() },
        });

        io.to(`game:${sessionId}`).emit('game:ended', {
          message: '🎱 All balls drawn. Game ended.',
        });

        cleanupRoom(sessionId);
        return;
      }

      // Draw next ball
      let nextBall: number;
      do {
        nextBall = Math.floor(Math.random() * maxBalls) + 1;
      } while (room.drawnNumbers.includes(nextBall));

      room.drawnNumbers.push(nextBall);
      room.currentBall = nextBall;

      // Update database
      await prisma.gameSession.update({
        where: { id: sessionId },
        data: {
          drawnNumbers: room.drawnNumbers as any,
          currentBall: nextBall,
        },
      });

      // Broadcast to all players
      io.to(`game:${sessionId}`).emit('game:ball', {
        ball: nextBall,
        drawnNumbers: room.drawnNumbers,
      });
    }, interval);
  };

  const cleanupRoom = (sessionId: string) => {
    const room = gameRooms.get(sessionId);
    if (room) {
      if (room.timer) clearInterval(room.timer);
      if (room.ballTimer) clearInterval(room.ballTimer);
      gameRooms.delete(sessionId);
    }
  };
};

/**
 * Server-side bingo validation (NEVER trust client)
 */
function validateBingo(
  card: any,
  drawnNumbers: number[],
  patternGrid: boolean[][]
): boolean {
  const matrix = card.matrix as number[][];
  const marked = card.marked as boolean[][];

  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      // If pattern requires this cell
      if (patternGrid[r][c]) {
        // FREE space is always valid
        if (matrix[r][c] === 0) continue;

        // Must be marked AND drawn
        if (!marked[r][c] || !drawnNumbers.includes(matrix[r][c])) {
          return false;
        }
      }
    }
  }

  return true;
}
