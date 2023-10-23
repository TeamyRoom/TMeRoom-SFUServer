import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import wrtc from 'wrtc';

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

const url = process.env.SPRING_SERVER_URL;

const app = express();
const httpServer = http.createServer(app);
const wsServer = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

const handleListen = () => console.log('Listening on http://localhost:3005');

let room = {
    teacherStream: null,
    reConnection: false,
    hlsVideo: null,
    teacherPc: null,
    studentPc: [],
};
let roomMap = new Map();
let teacherMap = new Map();
let studentMap = new Map(); //소켓, peerConnection 쌍

//---선생 RTCPeerConnection 정의

const createTeacherPc = async (teacherSocket, roomName) => {
    const pc = new wrtc.RTCPeerConnection({
        iceServers: [
            {
                urls: [
                    'stun:stun.l.google.com:19302',
                    'stun:stun1.l.google.com:19302',
                    'stun:stun2.l.google.com:19302',
                    'stun:stun3.l.google.com:19302',
                    'stun:stun4.l.google.com:19302',
                ],
            },
            {
                urls: 'turn:13.209.13.37:3478',
                username: 'your-username', // TURN 서버 사용자명
                credential: 'your-password', // TURN 서버 비밀번호
            },
        ],
    });

    pc.onicecandidate = (e) => {
        teacherSocket.emit('ice', e.candidate);
    };

    pc.ontrack = (e) => {
        console.log('Teacher Stream 감지 :  ', e.streams[0]);

        if (roomName && roomMap.has(roomName) && e.streams[0]) {
            let roomTemp = Object.assign({}, roomMap.get(roomName));
            roomTemp.teacherStream = e.streams[0];
            roomMap.set(roomName, roomTemp);
        } else {
            console.error('Invalid roomName or stream in the ontrack event.');
        }
    };

    pc.onconnectionstatechange = (e) => {
        console.log('teacherPeerConnection 상태 변화 : ', pc.connectionState);
        switch (pc.connectionState) {
            case 'failed':
                pc.close();
                break;
            case 'disconnected':
                pc.close();
                break;
            case 'closed':
                teacherSocket.disconnect();
                let roomTemp = Object.assign({}, roomMap.get(roomName));
                roomTemp.reConnection = true;
                roomMap.set(roomName, roomTemp);
                break;
            case 'connected':
                if (roomMap.get(roomName).reConnection) {
                    console.log('재연결');

                    for (let spc of roomMap.get(roomName).studentPc) {
                        try {
                            const videoTrack = roomMap.get(roomName).teacherStream.getVideoTracks()[0];
                            const videoSender = spc.getSenders().find((sender) => sender.track.kind === 'video');
                            videoSender.replaceTrack(videoTrack);
                        } catch {
                            (e) => {
                                console.log('재연결 에러 발생 : ', e);
                            };
                        }
                    }

                    let roomTemp = Object.assign({}, roomMap.get(roomName));
                    roomTemp.reConnection = false;
                    roomMap.set(roomName, roomTemp);
                } else {
                    teacherSocket.to(roomName).emit('welcome');
                    let roomTemp = Object.assign({}, roomMap.get(roomName));
                    roomTemp.reConnection = false;
                    roomMap.set(roomName, roomTemp);
                }

                break;

            default:
                break;
        }
    };

    return pc;
};

//---학생 RTCPeerConnection 정의

const createStudentPc = async (studentSocket, roomName) => {
    const pc = new wrtc.RTCPeerConnection({
        iceServers: [
            {
                urls: [
                    'stun:stun.l.google.com:19302',
                    'stun:stun1.l.google.com:19302',
                    'stun:stun2.l.google.com:19302',
                    'stun:stun3.l.google.com:19302',
                    'stun:stun4.l.google.com:19302',
                ],
            },
        ],
    });

    pc.onicecandidate = (e) => {
        studentSocket.emit('ice', e.candidate);
    };

    pc.onconnectionstatechange = (e) => {
        console.log('studentPeerConnection 상태 변화 : ', pc.connectionState);
        switch (pc.connectionState) {
            case 'failed':
                pc.close();
                break;
            case 'disconnected':
                pc.close();
                break;
            default:
                break;
        }
    };

    if (roomMap.get(roomName).teacherStream !== undefined) {
        console.log('StudentPc 생성 & Stream 적용 : ', roomMap.get(roomName).teacherStream);
        roomMap
            .get(roomName)
            .teacherStream.getTracks()
            .forEach((track) => pc.addTrack(track, roomMap.get(roomName).teacherStream));
    }

    return pc;
};

//---소켓 통신

wsServer.use((socket, next) => {
    const accessToken = socket.handshake.query.accessToken;
    const lecturecode = socket.handshake.query.lecturecode;
    console.log('토큰 수신 : ', accessToken, ' 강의코드 : ', lecturecode);

    const apiUrl = url + `/api/v1/auth/sfu/${lecturecode}/${accessToken}`;

    fetch(apiUrl)
        .then((response) =>
            response.json().then((json) => {
                console.log(json.resultCode);
                if (json.resultCode === 'SUCCESS') {
                    return next();
                }
                return next(new Error('Invalid token'));
            })
        )
        .catch((error) => {
            return next(new Error('Invalid token'));
        });
});

wsServer.on('connection', (socket) => {
    socket.on('join_room', async (roomName) => {
        if (!roomMap.has(roomName)) {
            let roomTemp = Object.assign({}, room);
            roomMap.set(roomName, roomTemp);
        }
        if (roomMap.get(roomName).teacherPc === null) {
            socket.join(roomName);
            console.log(roomName + ' 방의 인원수 : ' + wsServer.sockets.adapter.rooms.get(roomName).size);
            socket.emit('welcome');
            teacherMap.set(socket, null);
        } else if (roomMap.get(roomName).teacherPc.connectionState === 'closed') {
            socket.join(roomName);
            console.log(roomName + ' 방의 인원수 : ' + wsServer.sockets.adapter.rooms.get(roomName).size);
            socket.emit('welcome');
        } else socket.emit('denied');
    });

    socket.on('join_roomstudent', async (roomName) => {
        socket.join(roomName);
        console.log(roomName + ' 방의 인원수 : ' + wsServer.sockets.adapter.rooms.get(roomName).size);
        studentMap.set(socket, null);

        if (roomMap.has(roomName)) {
            if (roomMap.get(roomName).hlsVideo !== null)
                socket.emit('hls-video-option', roomMap.get(roomName).hlsVideo);
            socket.emit('welcome');
        }
    });

    socket.on('disconnect', () => {
        if (teacherMap.get(socket)) {
            teacherMap.get(socket).close();
            teacherMap.delete(socket);
        } else if (studentMap.get(socket)) {
            studentMap.get(socket).close();
            studentMap.delete(socket);
        }
    });

    socket.on('hls-video-option', async (jsonMessage, roomName) => {
        let roomTemp = Object.assign({}, roomMap.get(roomName));
        roomTemp.hlsVideo = jsonMessage;
        roomMap.set(roomName, roomTemp);
        teacherMap.set(socket, null);
        socket.to(roomName).emit('hls-video-option', jsonMessage);
    });

    socket.on('offerteacher', async (offer, roomName) => {
        try {
            let tempPc = await createTeacherPc(socket, roomName);
            teacherMap.set(socket, tempPc);
            let roomTemp = Object.assign({}, roomMap.get(roomName));
            roomTemp.teacherPc = tempPc;
            roomMap.set(roomName, roomTemp);
        } catch (e) {
            console.log(e);
        }

        teacherMap.get(socket).setRemoteDescription(offer);

        const answer = await teacherMap.get(socket).createAnswer({
            offerToReceiveAudio: true,
            offerToReceivevideo: true,
        });

        teacherMap.get(socket).setLocalDescription(answer);
        console.log('teacher offer 수신 & answer 송신');
        socket.emit('answer', answer);
    });

    socket.on('offerstudent', async (roomName) => {
        try {
            studentMap.set(socket, await createStudentPc(socket, roomName));
        } catch (e) {
            console.log(e);
        }

        let roomTemp = Object.assign({}, roomMap.get(roomName));
        roomTemp.studentPc.push(studentMap.get(socket));
        roomMap.set(roomName, roomTemp);

        const offer = await studentMap.get(socket).createOffer();
        studentMap.get(socket).setLocalDescription(offer);
        socket.emit('offer', offer);
        console.log('student offer 송신');
    });

    socket.on('answerstudent', (answer) => {
        studentMap.get(socket).setRemoteDescription(answer);
        console.log('student answer 수신');
    });

    socket.on('ice', (ice, role) => {
        if (role === 0 && ice !== null) {
            try {
                const candidate = new wrtc.RTCIceCandidate(ice);
                teacherMap.get(socket).addIceCandidate(candidate);
            } catch (e) {
                console.log('ICECandidate 수신 에러 : ', e);
            }
        } else if (ice !== null) {
            try {
                const candidate = new wrtc.RTCIceCandidate(ice);
                studentMap.get(socket).addIceCandidate(candidate);
            } catch (e) {
                console.log('ICECandidate 수신 에러 : ', e);
            }
        }
    });
});

httpServer.listen(3005, handleListen);
