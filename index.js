import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { availableParallelism } from 'node:os';
import cluster from 'node:cluster';
import { createAdapter, setupPrimary } from '@socket.io/cluster-adapter';

/*if (cluster.isPrimary) {
  const numCPUs = availableParallelism();
  // create one worker per available core
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork({
      PORT: 3000 + i
    });
  }
  
  // set up the adapter on the primary thread
  setupPrimary();
} else {*/
  const app = express();
  const server = createServer(app);
  const io = new Server(server, {
    connectionStateRecovery: {},
    // set up the adapter on each worker thread
    //adapter: createAdapter()
  });

  

  const db = await open({
    filename: 'chat.db',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_offset TEXT UNIQUE,
        content TEXT
    );
  `);

  const __dirname = dirname(fileURLToPath(import.meta.url));

  app.use(express.static(join(__dirname, 'public')));
  
  app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
  });

  io.on('connection', async (socket) => {
    //tracking rooms
    const defaultRoom = 'Lobby';
    socket.join(defaultRoom);
    socket.currentRoom = defaultRoom;
    socket.emit('joined room', defaultRoom);
    console.log(`Socket ${socket.id} connected and joined room: ${defaultRoom}`);
      try {
        await db.each(
          'SELECT id, content FROM messages WHERE id > ?',
          [socket.handshake.auth.serverOffset || 0],
          (_err, row) => {
            const msg = JSON.parse(row.content);
            if (msg.room === defaultRoom) {
              socket.emit('chat message', msg, row.id);
            }
          }
        );
      } catch (e) {
        console.error('Error fetching messages:', e);
      }

    socket.on('join room', async (roomName) => {
      // Leave previous room if any
      for (const room of socket.rooms) {
        if (room !== socket.id && room !== roomName) {
          socket.leave(room);
          console.log(`Socket ${socket.id} left room: ${room}`);
        }
      }
      // Join new room
      socket.join(roomName);
      socket.currentRoom = roomName;
      socket.emit('joined room', roomName);
      console.log(`Socket ${socket.id} joined room: ${roomName}`);

      try {
        await db.each(
          'SELECT id, content FROM messages WHERE id > ?',
          [socket.handshake.auth.serverOffset || 0],
          (_err, row) => {
            const msg = JSON.parse(row.content);
            if (msg.room === roomName) {
              socket.emit('chat message', msg, row.id);
            }
          }
        );
      } catch (e) {
        console.error('Error fetching messages:', e);
      }
    });



    socket.on('chat message', async (msgObj, clientOffset, callback) => {
      let result;

      msgObj.room = socket.currentRoom;

      try {
        result = await db.run(
          'INSERT INTO messages (content, client_offset) VALUES (?, ?)',
          JSON.stringify(msgObj), clientOffset
        );
      } catch (e) {
        if (e.errno === 19 /* SQLITE_CONSTRAINT */ ) {
          if (typeof callback === 'function') callback();
        }
        return;
      }
      if (socket.currentRoom) {
        io.to(socket.currentRoom).emit('chat message', msgObj, result.lastID);
      } else {
        io.emit('chat message', msgObj, result.lastID);
      }
      if (typeof callback === 'function') callback();
    });

    /*if (!socket.recovered) {
      try {
        await db.each('SELECT id, content FROM messages WHERE id > ?',
          [socket.handshake.auth.serverOffset || 0],
          (_err, row) => {
            socket.emit('chat message', JSON.parse(row.content), row.id);
          }
        )
      } catch (e) {
        console.error('Error fetching messages:', e);
      }
    }*/
  });

  // each worker will listen on a distinct port  - not anymore
  const port = 3000 //3001;

  server.listen(port, () => {
    console.log(`server running at http://localhost:${port}`);
  });
//}
// File: index.js




