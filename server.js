const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Simple Game State Tracker
const rooms = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Join a game room
    socket.on('joinRoom', ({ roomId, playerName }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = { players: [], deck: [], currentTurn: 0, gameStarted: false };
        }

        const room = rooms[roomId];
        
        // Prevent joining if room full or game started
        if (room.players.length >= 4 || room.gameStarted) {
            socket.emit('errorMsg', 'Room is full or game already started.');
            return;
        }

        room.players.push({ id: socket.id, name: playerName, cards: [] });
        console.log(`${playerName} joined room ${roomId}`);

        // Broadcast updated player list to everyone in the room
        io.to(roomId).emit('roomUpdate', room.players);
    });

    // Handle game start & card dealing
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.players.length < 2) return; // Need at least 2 players

        room.gameStarted = true;
        room.deck = createPusoyDeck();
        
        // Deal 13 cards to each player (standard Pusoy Dos setup)
        room.players.forEach(player => {
            player.cards = room.deck.splice(0, 13).sort((a, b) => a.value - b.value);
        });

        // Find who has the 3 of Clubs (traditional first player in Pusoy Dos)
        let startingPlayerIndex = 0;
        room.players.forEach((player, idx) => {
            if (player.cards.some(c => c.value === 3 && c.suit === '♣')) {
                startingPlayerIndex = idx;
            }
        });
        room.currentTurn = startingPlayerIndex;

        io.to(roomId).emit('gameStarted', {
            players: room.players.map(p => ({ id: p.id, name: p.name, cardCount: p.cards.length })),
            currentTurn: room.players[room.currentTurn].id
        });

        // Send private hands to individual players
        room.players.forEach(player => {
            io.to(player.id).emit('yourCards', player.cards);
        });
    });

    // Handle disconnects
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                room.players.splice(pIdx, 1);
                io.to(roomId).emit('roomUpdate', room.players);
                if (room.players.length === 0) delete rooms[roomId];
            }
        }
    });
});

// Helper function to build a regular card deck valued for Pusoy Dos
// In Pusoy Dos: 3 is lowest, 2 (Dos) is highest.
function createPusoyDeck() {
    const suits = ['♣', '♦', '♥', '♠']; // Clubs, Diamonds, Hearts, Spades (Standard ordering)
    const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    let deck = [];
    
    for (let rIdx = 0; rIdx < ranks.length; rIdx++) {
        for (let sIdx = 0; sIdx < suits.length; sIdx++) {
            deck.push({
                rank: ranks[rIdx],
                suit: suits[sIdx],
                value: rIdx * 4 + sIdx // Unique power value combining rank & suit hierarchy
            });
        }
    }
    
    // Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
