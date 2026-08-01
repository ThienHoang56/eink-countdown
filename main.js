const connectBtn = document.getElementById('connectBtn');
const syncBtn = document.getElementById('syncBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');
const canvas = document.getElementById('previewCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// Inputs
const taskInput = document.getElementById('taskName');
const hoursInput = document.getElementById('hours');
const minutesInput = document.getElementById('minutes');
const targetDatetimeInput = document.getElementById('targetDatetime');
const excludeHoursInput = document.getElementById('excludeHours');

// BLE Constants
const EPD_SERVICE_UUID = "13187b10-eba9-a3ba-044e-83d3217d9a38";
const EPD_CHAR_UUID = "4b646063-6264-f3a7-8941-e65356ea82fe";

let bluetoothDevice = null;
let epdCharacteristic = null;

// Draw Canvas Initial
function drawPreview() {
  const task = taskInput.value || "No Task";
  const hours = hoursInput.value || "0";
  const minutes = (minutesInput.value || "0").padStart(2, '0');
  
  // Clear white background
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // --- 1. HEADER BAR (Nền đen chữ trắng) ---
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, 212, 24);
  
  ctx.fillStyle = 'white';
  ctx.textBaseline = 'middle';
  
  // Task Name
  ctx.font = '700 13px "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  ctx.textAlign = 'left';
  let displayTask = task;
  if (displayTask.length > 15) displayTask = displayTask.substring(0, 15) + '...';
  ctx.fillText(displayTask, 8, 13);
  
  // Current Time (Top Right)
  const currentNow = new Date();
  const currentH = currentNow.getHours().toString().padStart(2, '0');
  const currentM = currentNow.getMinutes().toString().padStart(2, '0');
  ctx.font = '700 13px "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${currentH}:${currentM}`, 204, 13);
  
  // --- 2. MAIN CONTENT (Thời gian đếm ngược) ---
  ctx.fillStyle = 'black';
  ctx.textAlign = 'center';
  
  ctx.font = '700 14px "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  ctx.fillText('THỜI GIAN CÒN LẠI', 212 / 2, 45);
  
  // Đường kẻ ngang trang trí
  ctx.fillRect(56, 56, 100, 2);
  
  // Đồng hồ siêu to khổng lồ
  ctx.font = '900 48px "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  ctx.fillText(`${hours}:${minutes}`, 212 / 2, 84);
  
  ctx.textAlign = 'left'; // Reset
}

function calculateRemaining() {
  if (!targetDatetimeInput.value) return 0;
  
  const targetTime = new Date(targetDatetimeInput.value).getTime();
  const now = new Date().getTime();
  const excludeSeconds = (parseFloat(excludeHoursInput.value) || 0) * 3600;
  let diffSeconds = Math.floor((targetTime - now) / 1000) - excludeSeconds;
  
  if (diffSeconds < 0) diffSeconds = 0;
  
  const displayH = Math.floor(diffSeconds / 3600);
  const displayM = Math.floor((diffSeconds % 3600) / 60);
  
  hoursInput.value = displayH.toString();
  minutesInput.value = displayM.toString().padStart(2, '0');
  
  return diffSeconds;
}

// Hardcoded values as requested
taskInput.value = "PRN222 PE + FE";
targetDatetimeInput.value = "2026-08-02T07:00";

if (localStorage.getItem('eink_exclude')) {
  excludeHoursInput.value = localStorage.getItem('eink_exclude');
} else {
  excludeHoursInput.value = "9";
}

calculateRemaining();
drawPreview();

[taskInput, targetDatetimeInput, excludeHoursInput].forEach(el => {
  ['input', 'change'].forEach(evt => {
    el.addEventListener(evt, () => {
      localStorage.setItem('eink_task', taskInput.value);
      localStorage.setItem('eink_target', targetDatetimeInput.value);
      localStorage.setItem('eink_exclude', excludeHoursInput.value);
      
      if (el === targetDatetimeInput || el === excludeHoursInput) calculateRemaining();
      drawPreview();
    });
  });
});

connectBtn.addEventListener('click', async () => {
  try {
    statusDiv.innerText = "Requesting Bluetooth Device...";
    bluetoothDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'DLG-CLOCK-' }],
      optionalServices: [EPD_SERVICE_UUID]
    });

    statusDiv.innerText = "Connecting to GATT Server...";
    const server = await bluetoothDevice.gatt.connect();
    
    statusDiv.innerText = "Getting Service...";
    const service = await server.getPrimaryService(EPD_SERVICE_UUID);
    
    statusDiv.innerText = "Getting Characteristic...";
    epdCharacteristic = await service.getCharacteristic(EPD_CHAR_UUID);
    
    statusDiv.innerText = "Connected to E-ink Display!";
    connectBtn.innerText = "Connected";
    connectBtn.style.background = "#42b883";
    syncBtn.disabled = false;
    
    bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);
  } catch (error) {
    statusDiv.innerText = `Connection failed: ${error.message}`;
    console.error(error);
  }
});

function onDisconnected() {
  statusDiv.innerText = "Disconnected.";
  connectBtn.innerText = "Connect Bluetooth";
  connectBtn.style.background = "var(--primary)";
  syncBtn.disabled = true;
  bluetoothDevice = null;
  epdCharacteristic = null;
}

// Convert canvas to 1-bit eink format
function getEinkBuffer() {
  const width = canvas.width;   // 212
  const height = canvas.height; // 104
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  const totalBytes = Math.ceil((width * height) / 8);
  const buffer = new Uint8Array(totalBytes);
  buffer.fill(0); // Initialize with 0s
  
  let bitIdx = 0;
  // Transpose and flip according to C++ ESP32 e-ink logic:
  for (let x = width - 1; x >= 0; x--) {
    for (let y = 0; y < height; y++) {
      // index in RGBA buffer
      const i = (y * width + x) * 4;
      // Convert to grayscale
      const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
      
      // E-ink white is 1, black is 0
      const pixelWhite = brightness > 128 ? 1 : 0;
      
      if (pixelWhite === 1) {
        const byteIdx = Math.floor(bitIdx / 8);
        const bitOffset = 7 - (bitIdx % 8);
        buffer[byteIdx] |= (1 << bitOffset);
      }
      bitIdx++;
    }
  }
  
  return buffer;
}

let isUploading = false;

async function uploadToEink() {
  if (!epdCharacteristic || isUploading) return;
  isUploading = true;
  
  try {
    statusDiv.innerText = "Preparing data...";
    const buffer = getEinkBuffer();
    const totalBytes = buffer.length;
    
    statusDiv.innerText = "Sending data to E-ink...";
    
    const blockSize = 200;
    for (let i = 0; i < totalBytes; i += blockSize) {
      const len = Math.min(blockSize, totalBytes - i);
      const packet = new Uint8Array(4 + len);
      packet[0] = 0x03;
      packet[1] = 0xFF;
      packet[2] = (i >> 8) & 0xFF;
      packet[3] = i & 0xFF;
      packet.set(buffer.subarray(i, i + len), 4);
      
      await epdCharacteristic.writeValueWithResponse(packet);
      await new Promise(r => setTimeout(r, 20));
      statusDiv.innerText = `Sending: ${Math.round((i/totalBytes)*100)}%`;
    }
    
    statusDiv.innerText = "Sending Refresh Command...";
    await epdCharacteristic.writeValueWithResponse(new Uint8Array([0x01]));
    statusDiv.innerText = "Sync complete! Next update in 10 minutes.";
  } catch (error) {
    statusDiv.innerText = `Sync failed: ${error.message}`;
    console.error(error);
  } finally {
    isUploading = false;
  }
}

let countdownInterval;
let totalSeconds = 0;
let wakeLock = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (err) {
    console.error(`Wake Lock error: ${err.message}`);
  }
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release().then(() => wakeLock = null);
  }
}

document.addEventListener('visibilitychange', async () => {
  if (countdownInterval && document.visibilityState === 'visible') {
    await requestWakeLock();
  }
});

syncBtn.addEventListener('click', async () => {
  totalSeconds = calculateRemaining();
  
  if (totalSeconds <= 0) {
    alert("Vui lòng chọn thời gian đích trong tương lai!");
    return;
  }
  
  syncBtn.disabled = true;
  stopBtn.disabled = false;
  taskInput.disabled = true;
  targetDatetimeInput.disabled = true;
  excludeHoursInput.disabled = true;
  
  await requestWakeLock();
  
  // Lần đầu chạy sẽ gửi ảnh ngay lập tức
  await uploadToEink();
  
  countdownInterval = setInterval(async () => {
    totalSeconds = calculateRemaining();
    drawPreview();
    
    if (totalSeconds <= 0) {
      clearInterval(countdownInterval);
      await uploadToEink();
      stopCountdown();
      statusDiv.innerText = "Hết giờ!";
      return;
    }
    
    // Chỉ truyền qua Bluetooth mỗi khi tròn 10 phút (tiết kiệm pin E-ink)
    if (totalSeconds % 600 === 0 && totalSeconds > 0) {
      await uploadToEink();
    }
  }, 1000);
});

stopBtn.addEventListener('click', () => {
  stopCountdown();
});

function stopCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  syncBtn.disabled = false;
  stopBtn.disabled = true;
  taskInput.disabled = false;
  targetDatetimeInput.disabled = false;
  excludeHoursInput.disabled = false;
  statusDiv.innerText = "Đã dừng đếm ngược.";
  releaseWakeLock();
}
