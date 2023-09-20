const socket = io();

const call = document.getElementById("call");

call.hidden = true;

let roomName;
let myPeerConnection;
let joined = 0;
let muted = true;
let audioTracks;

// Welcome Form (join room)-------------------------------
const welcome = document.getElementById("welcome");
const welcomeForm = welcome.querySelector("form");
const peersFace = document.getElementById("peersFace");
const testFace = document.getElementById("testFace");
const playBackForm = document.getElementById("playBack");
const hlsForm = document.getElementById("hls");

async function initCall() {
    welcome.hidden = true;
    call.hidden = false;
    makeConnection();
}

async function handleWelcomeSubmit(event) {
    event.preventDefault();
    const input = welcomeForm.querySelector("input");
    await initCall();
    socket.emit("join_roomstudent", input.value);
    roomName = input.value;
    input.value = "";
}


welcomeForm.addEventListener("submit", handleWelcomeSubmit);

// Socket code

socket.on("welcome", () => {
    console.log("i got welcome");
    if (joined === 0) {
        joined = 1;
        socket.emit("offerstudent");
    }
});

socket.on("offer", async (offer) => {
    myPeerConnection.setRemoteDescription(offer);
    const answer = await myPeerConnection.createAnswer();
    myPeerConnection.setLocalDescription(answer);
    socket.emit("answerstudent", answer);
    console.log("sent my answer");
});

socket.on("ice", ice => {
    myPeerConnection.addIceCandidate(ice);
    console.log("i got ice");
});

socket.on("reconnect", () => {
    myPeerConnection.close();
    join = 0;
    makeConnection();
    socket.emit("offerstudent");

});

// RTC code

function makeConnection() {
    try {
        myPeerConnection = new RTCPeerConnection({
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
        myPeerConnection.addEventListener("icecandidate", handleIce);
        myPeerConnection.addEventListener("track", handleAddTrack);

    } catch (e) { console.log(e); }

}

function handleIce(data) {
    console.log("why??");
    socket.emit("ice", data.candidate, 1);
    console.log("sent my candidate");
}

function handleAddTrack(data) {


    console.log(data.streams[0]);

    peersFace.srcObject = data.streams[0];
    peersFace.muted = true;

    hlsForm.type = 'application/x-mpegURL'
}