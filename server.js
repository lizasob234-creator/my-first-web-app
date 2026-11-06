const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('joinRoom', ({ roomId, playerName }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = { players: [], deck: [], currentTurn: 0, gameStarted: false, lastPlayedHand: null, currentPot: 0 };
        }
        const room = rooms[roomId];
        if (room.players.length >= 4 || room.gameStarted) {
            socket.emit('errorMsg', 'Room full or started.');
            return;
        }
        
        // Players join with 5,000 starting chips!
        room.players.push({ id: socket.id, name: playerName, cards: [], chips: 5000 });
        io.to(roomId).emit('roomUpdate', room.players);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.players.length < 2) return;

        room.gameStarted = true;
        room.deck = createPusoyDeck();
        
        // 500 chip ante collected from every player for the match entry pot
        const ante = 500;
        room.currentPot = 0;
        
        room.players.forEach(player => {
            player.chips -= ante;
            room.currentPot += ante;
            player.cards = room.deck.splice(0, 13).sort((a, b) => a.value - b.value);
        });

        let startingPlayerIndex = 0;
        room.players.forEach((player, idx) => {
            if (player.cards.some(c => c.value === 0)) { 
                startingPlayerIndex = idx;
            }
        });
        room.currentTurn = startingPlayerIndex;

        sendGameState(roomId);
    });

    socket.on('playHand', ({ roomId, selectedCards }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurn];
        
        if (player.id !== socket.id) return; 

        player.cards = player.cards.filter(pc => 
            !selectedCards.some(sc => sc.rank === pc.rank && sc.suit === pc.suit)
        );

        room.lastPlayedHand = selectedCards;

        // Win check: first player out of cards takes the entire match pot!
        if (player.cards.length === 0) {
            player.chips += room.currentPot;
            io.to(roomId).emit('gameOver', `${player.name} won the round and took the 🪙 ${room.currentPot} chip pot! 🎉`);
            room.gameStarted = false;
            room.lastPlayedHand = null;
            sendGameState(roomId);
            return;
        }

        room.currentTurn = (room.currentTurn + 1) % room.players.length;
        sendGameState(roomId);
    });

    socket.on('passTurn', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        if (room.players[room.currentTurn].id !== socket.id) return;

        room.currentTurn = (room.currentTurn + 1) % room.players.length;
        sendGameState(roomId);
    });

    socket.on('disconnect', () => {
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

function sendGameState(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    io.to(roomId).emit('gameStateUpdate', {
        players: room.players.map(p => ({ id: p.id, name: p.name, cardCount: p.cards.length, chips: p.chips })),
        currentTurn: room.players[room.currentTurn] ? room.players[room.currentTurn].id : null,
        lastHand: room.lastPlayedHand,
        pot: room.currentPot,
        gameStarted: room.gameStarted
    });
    room.players.forEach(player => {
        io.to(player.id).emit('yourCards', player.cards);
    });
}

function createPusoyDeck() {
    const suits = ['♣', '♦', '♥', '♠']; 
    const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    let deck = [];
    for (let rIdx = 0; rIdx < ranks.length; rIdx++) {
        for (let sIdx = 0; sIdx < suits.length; sIdx++) {
            deck.push({ rank: ranks[rIdx], suit: suits[sIdx], value: rIdx * 4 + sIdx });
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
