let savedName = '';
let handLandmarker = null;
let cameraStream = null;
let animFrameId = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let isAsciiMode = false;
let offscreenCanvas = null;
let offscreenCtx = null;
let currentIsBlurred = false;
let captureMode = 'video';

/* ============================
   Page Navigation
   ============================ */

function goToPage(pageNumber) {
    const pages = document.querySelectorAll('.page');

    pages.forEach(page => {
        if (page.classList.contains('active')) {
            page.classList.remove('active');
            page.classList.add('exit');
        }
    });

    setTimeout(() => {
        pages.forEach(page => page.classList.remove('exit'));
        const target = document.getElementById('page' + pageNumber);
        target.classList.add('active');

        if (pageNumber === 2) {
            setTimeout(() => document.getElementById('nameInput').focus(), 400);
        }

        if (pageNumber === 3) {
            document.getElementById('displayName').textContent = savedName;
        }
    }, 300);
}

function submitName() {
    const input = document.getElementById('nameInput');
    const errorEl = document.getElementById('nameError');
    const wrapper = input.closest('.input-wrapper');
    const name = input.value.trim();

    wrapper.classList.remove('error');
    errorEl.textContent = '';

    if (!name) {
        wrapper.classList.add('error');
        errorEl.textContent = 'Nama tidak boleh kosong';
        input.focus();
        return;
    }

    if (name.length < 2) {
        wrapper.classList.add('error');
        errorEl.textContent = 'Nama minimal 2 karakter';
        input.focus();
        return;
    }

    savedName = name;
    goToPage(3);
}

document.getElementById('nameInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        submitName();
    }
});

document.getElementById('nameInput').addEventListener('input', function () {
    this.closest('.input-wrapper').classList.remove('error');
    document.getElementById('nameError').textContent = '';
});

/* ============================
   Toast
   ============================ */

function showToast(message, type) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type || ''}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add('show'));
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 2500);
}

/* ============================
   Camera + Hand Detection
   ============================ */

async function openCamera() {
    goToPage(4);
    setTimeout(() => initCamera(), 500);
}

function closeCamera() {
    if (isRecording) stopRecording();
    stopCamera();
    goToPage(3);
}

function stopCamera() {
    if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }

    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }

    const video = document.getElementById('cameraVideo');
    video.srcObject = null;
    video.classList.remove('blurred');
}

async function initCamera() {
    const video = document.getElementById('cameraVideo');
    const loadingEl = document.getElementById('cameraLoading');
    const errorEl = document.getElementById('cameraError');

    loadingEl.style.display = 'flex';
    errorEl.style.display = 'none';

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        video.srcObject = cameraStream;
        await video.play();

        await loadHandModel();

        loadingEl.style.display = 'none';

        // Start loop only once
        if (!animFrameId) {
            detectLoop();
        }
    } catch (err) {
        console.error('Camera error:', err);
        loadingEl.style.display = 'none';
        errorEl.innerHTML = `<p>❌ Gagal mengakses kamera<br><span style="font-size:0.7rem;opacity:0.7">${err.message}</span></p><button class="btn-retry" onclick="initCamera()">Coba Lagi</button>`;
        errorEl.style.display = 'flex';
    }
}

async function loadHandModel() {
    if (handLandmarker) return;

    const vision = await import(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs'
    );

    const filesetResolver = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
    );

    handLandmarker = await vision.HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
            modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
            delegate: 'CPU'
        },
        numHands: 2,
        runningMode: 'VIDEO'
    });
}

/* ============================
   Fist Detection (ported from Python)
   ============================ */

function isFist(landmarks) {
    const fingerTips = [8, 12, 16, 20];
    const fingerPips = [6, 10, 14, 18];

    let closedCount = 0;

    for (let i = 0; i < fingerTips.length; i++) {
        if (landmarks[fingerTips[i]].y > landmarks[fingerPips[i]].y) {
            closedCount++;
        }
    }

    const thumbTip = landmarks[4];
    const thumbIp = landmarks[3];
    const thumbMcp = landmarks[2];

    if (Math.abs(thumbTip.x - thumbMcp.x) < Math.abs(thumbIp.x - thumbMcp.x)) {
        closedCount++;
    }

    return closedCount >= 4;
}

/* ============================
   Detection Loop
   ============================ */

let lastDetectTime = 0;

function detectLoop() {
    // Selalu jadwalkan frame berikutnya di awal agar loop tidak pernah mati
    animFrameId = requestAnimationFrame(detectLoop);

    try {
        const video = document.getElementById('cameraVideo');

        // Pastikan video sudah siap dan memiliki dimensi
        if (!cameraStream || video.paused || video.ended || video.readyState < 2 || video.videoWidth === 0) {
            return;
        }

        const now = performance.now();

        // ---- Deteksi tangan (di-throttle, hanya mode biasa) ----
        if (now - lastDetectTime > 100 && handLandmarker) {
            lastDetectTime = now;

            if (!isAsciiMode) {
                const results = handLandmarker.detectForVideo(video, now);
                let handDetected = false;
                let fistDetected = false;

                if (results.landmarks && results.landmarks.length > 0) {
                    handDetected = true;
                    for (const landmarks of results.landmarks) {
                        if (isFist(landmarks)) {
                            fistDetected = true;
                            break;
                        }
                    }
                }

                if (handDetected && !fistDetected) {
                    video.classList.add('blurred');
                    currentIsBlurred = true;
                } else if (fistDetected) {
                    video.classList.remove('blurred');
                    currentIsBlurred = false;
                } else {
                    video.classList.remove('blurred');
                    currentIsBlurred = false;
                }
            } else {
                video.classList.remove('blurred');
                currentIsBlurred = false;
            }
        }

        // ---- Rendering canvas (setiap frame, ~60fps) ----
        const canvas = document.getElementById('cameraCanvas');
        if (canvas.width !== video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }
        const ctx = canvas.getContext('2d');

        // Logika crop untuk Zoom
        const zoom = parseFloat(document.getElementById('zoomSlider').value) || 1;
        const sWidth = video.videoWidth / zoom;
        const sHeight = video.videoHeight / zoom;
        const sx = (video.videoWidth - sWidth) / 2;
        const sy = (video.videoHeight - sHeight) / 2;

        if (isAsciiMode) {
            // Tentukan ukuran font kecil untuk detail tinggi
            const fontSize = 4.5;
            const charWidth = fontSize * 0.6; // Proporsi standar monospace (lebar 60% dari tinggi)
            const charHeight = fontSize;

            const cols = Math.floor(canvas.width / charWidth);
            const rows = Math.floor(canvas.height / charHeight);

            // Setup offscreen canvas
            if (!offscreenCanvas) {
                offscreenCanvas = document.createElement('canvas');
                offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
            }
            if (offscreenCanvas.width !== cols || offscreenCanvas.height !== rows) {
                offscreenCanvas.width = cols;
                offscreenCanvas.height = rows;
            }

            // Gambar video ke canvas kecil (mirror)
            offscreenCtx.save();
            offscreenCtx.translate(cols, 0);
            offscreenCtx.scale(-1, 1);
            offscreenCtx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, cols, rows);
            offscreenCtx.restore();

            // Ambil pixel data
            const frameData = offscreenCtx.getImageData(0, 0, cols, rows).data;
            const asciiChars = " .:-=+*#%@";

            // Background hitam penuh
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Font setting
            ctx.font = `bold ${fontSize}px monospace`;
            ctx.textBaseline = "top";
            ctx.fillStyle = "#ffffff";

            // Render per baris
            for (let y = 0; y < rows; y++) {
                let rowStr = "";
                for (let x = 0; x < cols; x++) {
                    const i = (y * cols + x) * 4;
                    const brightness = (frameData[i] * 0.299 + frameData[i+1] * 0.587 + frameData[i+2] * 0.114);
                    const charIndex = Math.floor((brightness / 255) * (asciiChars.length - 1));
                    rowStr += asciiChars[charIndex];
                }
                ctx.fillText(rowStr, 0, y * charHeight);
            }
        } else {
            ctx.save();
            ctx.translate(canvas.width, 0); // Mirroring
            ctx.scale(-1, 1);
            if (currentIsBlurred) {
                ctx.filter = 'blur(24px)';
            } else {
                ctx.filter = 'none';
            }

            ctx.fillStyle = "black";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);
            ctx.restore();
        }
    } catch (err) {
        console.error("Error in detection loop:", err);
    }
}



/* ============================
   Video Recording
   ============================ */

function switchMode(mode) {
    if (isRecording) stopRecording(); // Stop recording if switching modes
    
    captureMode = mode;
    const btnVideo = document.getElementById('btnModeVideo');
    const btnPhoto = document.getElementById('btnModePhoto');
    const slider = document.getElementById('modeSlider');
    const recordBtn = document.getElementById('btnRecord');

    if (mode === 'video') {
        btnVideo.classList.add('active');
        btnPhoto.classList.remove('active');
        slider.style.transform = 'translateX(0)';
        recordBtn.classList.remove('photo-mode');
    } else {
        btnPhoto.classList.add('active');
        btnVideo.classList.remove('active');
        slider.style.transform = 'translateX(100%)';
        recordBtn.classList.add('photo-mode');
    }
}

function handleCapture() {
    if (captureMode === 'video') {
        toggleRecording();
    } else {
        takePhoto();
    }
}

function takePhoto() {
    const canvas = document.getElementById('cameraCanvas');
    
    // Screen flash effect
    const flash = document.getElementById('screenFlash');
    flash.classList.remove('flash');
    void flash.offsetWidth; // Trigger reflow to restart animation
    flash.classList.add('flash');

    // Ambil data gambar dari canvas
    const dataUrl = canvas.toDataURL('image/png');
    
    // Proses download otomatis
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `jepretan-kamera-${new Date().getTime()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

function startRecording() {
    const canvas = document.getElementById('cameraCanvas');
    // Ambil stream dari canvas (30 FPS)
    const stream = canvas.captureStream(30);
    
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    recordedChunks = [];
    
    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
            recordedChunks.push(e.data);
        }
    };
    
    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'rekaman-kamera.webm';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    };
    
    mediaRecorder.start();
    isRecording = true;
    
    document.getElementById('btnRecord').classList.add('recording');
    document.getElementById('recordText').textContent = 'Berhenti Rekam';
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    isRecording = false;
    
    document.getElementById('btnRecord').classList.remove('recording');
    document.getElementById('recordText').textContent = 'Rekam Video';
}

/* ============================
   Zoom Control
   ============================ */

document.getElementById('zoomSlider').addEventListener('input', function(e) {
    const zoom = parseFloat(e.target.value);
    const video = document.getElementById('cameraVideo');
    video.style.transform = `scaleX(-1) scale(${zoom})`;
});

/* ============================
   ASCII Control
   ============================ */

function toggleAsciiMode() {
    isAsciiMode = !isAsciiMode;
    const container = document.querySelector('.fullscreen-camera');
    const btn = document.getElementById('btnAscii');
    
    if (isAsciiMode) {
        container.classList.add('ascii-mode');
        btn.classList.add('active');
    } else {
        container.classList.remove('ascii-mode');
        btn.classList.remove('active');
    }
}
