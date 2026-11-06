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

    socket.on('joinRoom', ({ roomId, playerName, avatar }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = { players: [], deck: [], currentTurn: 0, gameStarted: false, lastPlayedHand: null, currentPot: 0, passCount: 0 };
        }
        const room = rooms[roomId];
        if (room.players.length >= 4 || room.gameStarted) {
            socket.emit('errorMsg', 'Room full or started.');
            return;
        }
        
        // Save the chosen avatar along with player info
        room.players.push({ 
            id: socket.id, 
            name: playerName, 
            avatar: avatar || "👤", 
            cards: [], 
            chips: 5000 
        });
        io.to(roomId).emit('roomUpdate', room.players);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.players.length < 2) return;

        room.gameStarted = true;
        room.deck = createPusoyDeck();
        room.lastPlayedHand = null;
        room.passCount = 0;
        
        const ante = 500;
        room.currentPot = 0;
        
        room.players.forEach(player => {
            player.chips -= ante;
            room.currentPot += ante;
            player.cards = room.deck.splice(0, 13).sort((a, b) => a.value - b.value);
        });

        // The player holding the 3 of Clubs (value 0) always goes first
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

        // --- PUSOY DOS VALIDATION LOGIC ---
        // Sort selected cards by rule value
        selectedCards.sort((a, b) => a.value - b.value);

        if (room.lastPlayedHand && room.lastPlayedHand.length > 0) {
            // Must drop the exact same count of cards (e.g. Single vs Single, Pair vs Pair)
            if (selectedCards.length !== room.lastPlayedHand.length) {
                socket.emit('errorMsg', `You must play exactly ${room.lastPlayedHand.length} card(s)!`);
                return;
            }

            // Simple validation for Singles and Pairs
            if (selectedCards.length === 1) {
                if (selectedCards[0].value <= room.lastPlayedHand[0].value) {
                    socket.emit('errorMsg', 'Card value is too low to beat the table!');
                    return;
                }
            } else if (selectedCards.length === 2) {
                if (selectedCards[0].rank !== selectedCards[1].rank) {
                    socket.emit('errorMsg', 'Invalid pair! Cards must be the same rank.');
                    return;
                }
                // Compare highest card of the pair to beat the last highest card
                if (selectedCards[1].value <= room.lastPlayedHand[1].value) {
                    socket.emit('errorMsg', 'Pair value is too low to beat the table!');
                    return;
                }
            }
            // (Note: 5-card hand combos can expand here later!)
        } else {
            // New round tracking validation
            if (selectedCards.length === 2 && selectedCards[0].rank !== selectedCards[1].rank) {
                socket.emit('errorMsg', 'Invalid combination!');
                return;
            }
        }

        // Remove validated played cards from hand
        player.cards = player.cards.filter(pc => 
            !selectedCards.some(sc => sc.rank === pc.rank && sc.suit === pc.suit)
        );

        room.lastPlayedHand = selectedCards;
        room.passCount = 0; // Reset pass count on safe play

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

        room.passCount++;
        
        // If everyone passes back to the master controller, clear table context pool
        if (room.passCount >= room.players.length - 1) {
            room.lastPlayedHand = null;
            room.passCount = 0;
        }

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
        players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, cardCount: p.cards.length, chips: p.chips })),
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
