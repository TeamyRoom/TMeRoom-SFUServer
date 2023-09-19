import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import SocketIO from "socket.io";
import e from "express";
import { start } from "repl";
import * as mediasoupClient from "mediasoup-client";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

const WebSocket = require('ws');

const fs = require('fs');
const path = require('path');
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

let writeStream;

let teacherPc;
let teacherStream;
let teacherSenders = {};
let studentPc = new Map();    //소켓, peerConnection 쌍
let reConnection = 0;
let teacherDevice;
let room;

//---선생 RTCPeerConnection 정의

const createTeacherPc = async (teacherSocket) => {
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
    // console.log("I sent ice");
    teacherSocket.emit("ice", e.candidate);
  };

  pc.oniceconnectionstatechange = (e) => {
    //console.log(e);
  };

  pc.ontrack = (e) => {
    console.log("input stream in ts ", e.streams[0]);
    teacherStream = e.streams[0];
    teacherSenders = pc.getSenders();
  };

  pc.onconnectionstatechange = (e) => {
    console.log("tpc has changed", pc.connectionState);
    switch (pc.connectionState) {
      case "disconnected":
        if (teacherPc) teacherPc.close();
        teacherStream = null;
        teacherPc = null;
        reConnection = 1;
        break;
      case "failed":
        if (teacherPc) teacherPc.close();
        teacherStream = null;
        teacherPc = null;
        reConnection = 1;
        break;
      case "connected":

        if (reConnection === 1) {
          console.log("reconnecting");

          for (let spc of studentPc.values()) {
            spc.close();
          }

          for (let sSock of studentPc.keys()) {
            sSock.emit("reconnect");
          }
          reConnection = 0;

        }

        else {
          for (let sSock of studentPc.keys()) {
            sSock.emit("welcome");
          }
        }

        
        break;

    }
  }

  return pc;

}

//---학생 RTCPeerConnection 정의

const createStudentPc = async (studentSocket) => {
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
    // console.log("I sent ice");
    studentSocket.emit("ice", e.candidate);
  };

  pc.oniceconnectionstatechange = (e) => {
    //console.log(e);
  };

  if (teacherStream) teacherStream.getTracks().forEach(track => pc.addTrack(track, teacherStream));

  return pc;
}

//---소켓 통신

wsServer.on("connection", socket => {

  socket.on("join_room", async (roomName) => {
    room = roomName;
    socket.join(roomName);
    socket.emit("welcome");
  });

  socket.on('join_roomstudent', async (roomName) => {
    room = roomName;
    socket.join(roomName);
    studentPc.set(socket, null);
    if (teacherStream) socket.emit("welcome");
  });

  socket.on("offerteacher", async (offer) => {
    console.log("start offerteacher");
    try {
      teacherPc = await createTeacherPc(socket);
      console.log("created pc");
    } catch (e) { console.log(e); }
    teacherPc.setRemoteDescription(offer);
    console.log("set remotedDescription");
    const answer = await teacherPc.createAnswer({
      offerToReceiveAudio: true,
      offerToReceivevideo: true,
    });
    console.log("created answer");

    teacherPc.setLocalDescription(answer);
    console.log("set localDescription");
    socket.emit("answer", answer);

  });


  socket.on("offerstudent", async () => {
    try {
      studentPc.set(socket, await createStudentPc(socket));
    } catch (e) { console.log(e); }
    const offer = await studentPc.get(socket).createOffer();
    studentPc.get(socket).setLocalDescription(offer);
    socket.emit("offer", offer);
    console.log("send offer to student");
  });

  socket.on("answerstudent", (answer) => {
    studentPc.get(socket).setRemoteDescription(answer);
    console.log("i got answer from studnet");
  });

  socket.on("ice", (ice, role) => {
    if (role === 0) {
      let candidate = new wrtc.RTCIceCandidate(ice);

      teacherPc.addIceCandidate(candidate).then(_ => {
      }).catch(e => {
        console.log("Error: Failure during addIceCandidate()");
      });
    }
    else {
      let candidate = new wrtc.RTCIceCandidate(ice);

      studentPc.get(socket).addIceCandidate(candidate).then(_ => {
      }).catch(e => {
        console.log("Error: Failure during addIceCandidate()");
      });
    }
  });
})

httpServer.listen(3005, handleListen);
