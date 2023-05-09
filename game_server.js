const express = require('express');
const app = express();
const http = require("http");
const { Server } = require('socket.io');
const cors = require("cors");

app.use(cors());
const server = http.createServer(app);
let currCircle = null;
let timer = 60;
let rooms = {};
const port = process.env.PORT;
let score = 0;

let setGive = true;
let setTake = true;
let setRequest = true;
let setTimer = true;

//set up socket.io server with localhost:3000 and allow cors
const io = new Server(server, {
  cors: {
    origin: ["https://pen-experiment-tlin41390.vercel.app", "http://localhost:3000"],
    methods: ["GET", "POST"],
  },
});

console.log("starting server...");

//generate a circle with random x and y coordinates
//then send to the client
const generateCircle = (room) => {
  const newCircle = {
    x: Math.floor(30 + Math.random() * 60),
    y: Math.floor(10 + Math.random() * 80),
    radius: 35,
    clicked: false,
  };
  currCircle = newCircle;
  io.to(room).emit("current_circle", currCircle);

};

//set up socket.io connection with client side 
io.on("connection", (socket) => {
  if (socket.handshake.headers.origin === "https://pen-experiment-tlin41390.vercel.app") {
    console.log(`User connected: ${socket.id}`);
  }
  socket.on("enable_give", (data) => {
    setGive = data;
  });

  socket.on("enable_take", (data) => {
    setTake = data;
  });

  socket.on("enable_request", (data) => {
    setRequest = data;
  });

  socket.on("enable_timer", (data) => {
    setTimer = data;
  });

  socket.on("set_time", (data) => {
    timer = data;
  });

  io.emit("send_give", setGive);
  io.emit("send_take", setTake);
  io.emit("send_request", setRequest);
  io.emit("send_timer", setTimer);
  io.emit("init_time", timer);
  //make a player object for each users
  const player = {
    id: socket.id,
    score: 0,
    give: 0,
    take: 0,
    request: 0,
    survey_id: null,
    timestamps: []
  };


  let availablerooms = null;
  io.sockets.adapter.rooms.forEach((room, roomId) => {
    if (roomId.startsWith("room-") && room.size < 2) {
      availablerooms = roomId;
    }
  });

  io.to(availablerooms).emit("initial_score", score);

  //if there is no available room, create a new room and join it 
  if (!availablerooms) {
    //check to see if the socket has the origin: "https://pen-experiment-tlin41390.vercel.app"
    //if so, join the room
    //if not, do not join the room
    if (socket.handshake.headers.origin === "https://pen-experiment-tlin41390.vercel.app") {
      availablerooms = `room-${Date.now()}`;
      socket.join(availablerooms);
      //create a new room object with the players
      const room = {
        room_id: availablerooms,
        players: [],
      };
      room.players.push(player);
      rooms[availablerooms] = room;
    }
  } else {
    if (socket.handshake.headers.origin === "https://pen-experiment-tlin41390.vercel.app") {
      socket.join(availablerooms);
      rooms[availablerooms].players.push(player);
      // set opponent
      rooms[availablerooms].players.forEach((p) => {
        if (p.id !== player.id) {
          player.opponent = p.id;
          p.opponent = player.id;
        }
      });
      io.to(availablerooms).emit("start_game", true);
      io.emit("get_room", availablerooms);
    }
  }

  //check if the settings for the buttons are enabled


  socket.emit("room_id", availablerooms, socket.id);

  const clients = io.sockets.adapter.rooms.get(availablerooms);
  const numClients = clients ? clients.size : 0;

  //start the game when there are two players in the room
  if (numClients === 2) {
    generateCircle(availablerooms);
    socket.to(availablerooms).emit("start_game", true);
    io.emit("get_room", availablerooms);
    io.emit("init_game", 60, availablerooms);
    const opponent = rooms[availablerooms].players.find(
      (p) => p.id === player.opponent
    );
    const rng = Math.round(Math.random());

    //randomly choose who can click first
    if (rng === 0) {
      io.to(player.id).emit("can_click", true);
      io.to(opponent.id).emit("can_click", false);
    } else {
      io.to(player.id).emit("can_click", false);
      io.to(opponent.id).emit("can_click", true);
    }

  }

  //when the circle is clicked, update the score and generate a new circle
  socket.on("circle_clicked", (time) => {
    player.score++;
    player.timestamps.push(time);
    if (currCircle) {
      currCircle = null;
      // update score
      io.to(player.id).emit("update_score", player.id, player.score);
      // update opponent's score
      const opponent = rooms[availablerooms].players.find(
        (p) => p.id === player.opponent
      );
      io.to(opponent.id).emit("update_opp_score", player.id, player.score);
      generateCircle(availablerooms);
    }
  });

  //send the opponents time left to the player
  socket.on("record time", (roomID,time) => {
    const opponent = rooms[availablerooms].players.find(
      (p) => p.id === player.opponent
    );
    socket.emit("append_progess", roomID,time);
    io.to(opponent.id).emit("update_time", time);
  });

  socket.on("give", () => {
    player.give++;
    const opponent = rooms[availablerooms].players.find(
      (p) => p.id === player.opponent
    );
    io.to(opponent.id).emit("can_click", true);
  })

  socket.on("receive_request", () => {
    player.request++;
    const opponent = rooms[availablerooms].players.find(
      (p) => p.id === player.opponent
    );
    io.to(opponent.id).emit("receive_request");
  })

  socket.on("take", () => {
    player.take++;
    const opponent = rooms[availablerooms].players.find(
      (p) => p.id === player.opponent
    );
    io.to(opponent.id).emit("can_click", false);
  })

  socket.on("submit_survey", (survey) => {
    player.survey_id = survey;
    console.log(player.survey_id);
  });


  //when the timer is up, send the score to the client side and reset the score to 0
  socket.on("disconnect", () => {
    if (socket.handshake.headers.origin === "https://pen-experiment-tlin41390.vercel.app") {
      console.log(`User disconnected: ${socket.id}`);
      if (io.sockets.adapter.rooms.get(availablerooms) == null) {
        console.log(`Room ${availablerooms} is empty`);
        io.of("/").adapter.rooms.delete(availablerooms);
        clearInterval(timer);
      }
    }
  });


  if (numClients === 2 && !rooms[availablerooms].timerStarted) {
    rooms[availablerooms].timerStarted = true;
  }
});

server.listen(port, () => {
  console.log(`pen listening on ${port}`);
});