import express from "express";
import http from "http";
import SocketIO from "socket.io";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

const wrtc = require("wrtc");

const app = express();
const httpServer = http.createServer(app);
const wsServer = SocketIO(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.set("view engine", "pug");
app.set("views", __dirname + "/views");
app.engine("pug", require("pug").__express);

app.use("/public", express.static(__dirname + "/public"));

app.get("/", (req, res) => res.render("home_teacher"));
app.get("/student", (req, res) => res.render("home_student"));

const handleListen = () => console.log('Listening on http://localhost:3005');

let room = {
  teacherStream: null,
  reConnection: false,
  hlsVideo: null,
  studentPc: [],
}
let roomMap = new Map();
let teacherMap = new Map();
let studentMap = new Map();    //소켓, peerConnection 쌍

//---선생 RTCPeerConnection 정의

const createTeacherPc = async (teacherSocket, roomName) => {
  const pc = new wrtc.RTCPeerConnection({
    iceServers: [
      {
        urls: [
          "stun:stun.l.google.com:19302",
          "stun:stun1.l.google.com:19302",
          "stun:stun2.l.google.com:19302",
          "stun:stun3.l.google.com:19302",
          "stun:stun4.l.google.com:19302",
        ]
      }
    ]
  });

  pc.onicecandidate = (e) => {
    teacherSocket.emit("ice", e.candidate);
  };

  pc.oniceconnectionstatechange = (e) => {
    //console.log(e);
  };

  pc.ontrack = (e) => {
    console.log("input stream in ts ", e.streams[0]);

    if (roomName && roomMap.has(roomName) && e.streams[0]) {
      let roomTemp = Object.assign({}, roomMap.get(roomName));
      roomTemp.teacherStream = e.streams[0];
      roomMap.set(roomName, roomTemp);
    } else {
      console.error("Invalid roomName or stream in the ontrack event.");
    }
  };

  pc.onconnectionstatechange = (e) => {
    console.log("tpc has changed", pc.connectionState);
    switch (pc.connectionState) {
      case "disconnected":
        pc.close();
        let roomTemp = Object.assign({}, roomMap.get(roomName));
        roomTemp.reConnection = true;
        roomMap.set(roomName, roomTemp);
        break;
      case "failed":
        pc.close();
        let roomTemp2 = Object.assign({}, roomMap.get(roomName));
        roomTemp2.reConnection = true;
        roomMap.set(roomName, roomTemp2);
        break;
      case "connected":
        if (roomMap.get(roomName).reConnection) {
          console.log("reconnecting");

          for (let spc of roomMap.get(roomName).studentPc) {
            if (spc) spc.close();
            console.log('학생커넥션 닫음');
          }
          teacherSocket.to(roomName).emit("reconnect");
          let roomTemp = Object.assign({}, roomMap.get(roomName));
          roomTemp.reConnection = false;
          roomMap.set(roomName, roomTemp);
        }

        else {
          teacherSocket.to(roomName).emit("welcome");
          let roomTemp = Object.assign({}, roomMap.get(roomName));
          roomTemp.reConnection = false;
          roomMap.set(roomName, roomTemp);
        }

        break;

    }
  }

  return pc;

}

//---학생 RTCPeerConnection 정의

const createStudentPc = async (studentSocket, roomName) => {
  const pc = new wrtc.RTCPeerConnection({
    iceServers: [
      {
        urls: [
          "stun:stun.l.google.com:19302",
          "stun:stun1.l.google.com:19302",
          "stun:stun2.l.google.com:19302",
          "stun:stun3.l.google.com:19302",
          "stun:stun4.l.google.com:19302",
        ]
      }
    ]
  });

  pc.onicecandidate = (e) => {
    studentSocket.emit("ice", e.candidate);
  };

  pc.oniceconnectionstatechange = (e) => {
    //console.log(e);
  };

  if (roomMap.get(roomName).teacherStream !== undefined) {
    console.log("Create StudentPc and get Stream : ", roomMap.get(roomName).teacherStream);
    roomMap.get(roomName)
      .teacherStream
      .getTracks()
      .forEach(track => pc.addTrack(track, roomMap.get(roomName).teacherStream));
  }

  return pc;
}

//---소켓 통신

wsServer.on("connection", socket => {

  socket.on("join_room", async (roomName) => {
    if (!roomMap.has(roomName)) {
      let roomTemp = Object.assign({}, room);
      roomMap.set(roomName, roomTemp);
      teacherMap.set(socket, null);
    }
    socket.join(roomName);
    socket.emit("welcome");
  });

  socket.on('join_roomstudent', async (roomName) => {
    socket.join(roomName);
    studentMap.set(socket, null);
    
    if (roomMap.has(roomName)) {
      if (roomMap.get(roomName).hlsVideo !== null) socket.emit('hls-video-option', roomMap.get(roomName).hlsVideo);
      socket.emit("welcome");
    }
  });

  socket.on('hls-video-option', async (jsonMessage, roomName) => {
    let roomTemp = Object.assign({}, roomMap.get(roomName));
    roomTemp.hlsVideo = jsonMessage;
    roomMap.set(roomName, roomTemp);
    teacherMap.set(socket, null);
    socket.to(roomName).emit('hls-video-option', jsonMessage);
  })

  socket.on("offerteacher", async (offer, roomName) => {
    console.log("start offerteacher");
    try {
      let tempPc = await createTeacherPc(socket, roomName);
      teacherMap.set(socket, tempPc);
      console.log("created pc");
    } catch (e) { console.log(e); }
    teacherMap.get(socket).setRemoteDescription(offer);
    console.log("set remotedDescription");
    const answer = await teacherMap.get(socket).createAnswer({
      offerToReceiveAudio: true,
      offerToReceivevideo: true,
    });
    console.log("created answer");

    teacherMap.get(socket).setLocalDescription(answer);
    console.log("set localDescription");
    socket.emit("answer", answer);

  });


  socket.on("offerstudent", async (roomName) => {
    try {
      studentMap.set(socket, await createStudentPc(socket, roomName));
    } catch (e) { console.log(e); }

    let roomTemp = Object.assign({}, roomMap.get(roomName));
    roomTemp.studentPc.push(studentMap.get(socket));
    roomMap.set(roomName, roomTemp);

    const offer = await studentMap.get(socket).createOffer();
    studentMap.get(socket).setLocalDescription(offer);
    socket.emit("offer", offer);
    console.log("send offer to student");
  });

  socket.on("answerstudent", (answer) => {
    studentMap.get(socket).setRemoteDescription(answer);
    console.log("i got answer from studnet");
  });

  socket.on("ice", (ice, role) => {
    if (role === 0) {
      let candidate = new wrtc.RTCIceCandidate(ice);

      teacherMap.get(socket).addIceCandidate(candidate).then(_ => {
      }).catch(e => {
        console.log("IceCandidate is null or error : ", e);
      });
    }
    else {
      let candidate = new wrtc.RTCIceCandidate(ice);

      studentMap.get(socket).addIceCandidate(candidate).then(_ => {
      }).catch(e => {
        console.log("IceCandidate is null or error : ", e);
      });
    }
  });
})

httpServer.listen(3005, handleListen);
