/**
 * SafeMed FCM Notification Server - FIXED VERSION
 * 
 * QUAN TRỌNG: Sử dụng DATA-ONLY message để onMessageReceived() 
 * luôn được gọi dù app foreground hay background
 */

require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const cron = require('node-cron');

const app = express();
app.use(express.json());

// Initialize Firebase Admin SDK
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // ƯU TIÊN: Nếu chạy trên Railway, sử dụng dữ liệu từ biến môi trường
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log("✅ Firebase initialized via Environment Variable.");
  } catch (e) {
    console.error("❌ Lỗi định dạng JSON trong biến FIREBASE_SERVICE_ACCOUNT:", e.message);
    console.error("Vui lòng kiểm tra lại nội dung biến môi trường trên Railway.");
    process.exit(1); // Dừng server nếu JSON sai định dạng
  }
} else {
  // DỰ PHÒNG: Nếu chạy local, mới tìm file vật lý
  try {
    serviceAccount = require('./service-account.json');
    console.log("✅ Firebase initialized via local service-account.json file.");
  } catch (e) {
    console.error("❌ Không tìm thấy file service-account.json và không có biến FIREBASE_SERVICE_ACCOUNT.");
    console.error("Hãy tạo file service-account.json hoặc thiết lập biến môi trường.");
    process.exit(1);
  }
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const messaging = admin.messaging();

// ===== Translations =====
const translations = {
  vi: {
    slots: { morning: "Sáng", noon: "Trưa", afternoon: "Chiều", evening: "Tối" },
    title: (slot) => `💊 Nhắc uống thuốc ${slot.toLowerCase()}`,
    detailed: (name, dose) => `Đã đến giờ uống ${name}${dose ? ` - ${dose}` : ""}`,
    general: (slot) => `Đã đến giờ uống thuốc buổi ${slot.toLowerCase()}. Hãy nhớ uống đúng liều!`
  },
  en: {
    slots: { morning: "Morning", noon: "Noon", afternoon: "Afternoon", evening: "Evening" },
    title: (slot) => `💊 ${slot} medication reminder`,
    detailed: (name, dose) => `Time to take ${name}${dose ? ` - ${dose}` : ""}`,
    general: (slot) => `Time to take your ${slot.toLowerCase()} medication!`
  }
};

// ===== Helper Functions =====
function getCurrentTimeInTimezone(tz) {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { 
      timeZone: tz || 'Asia/Ho_Chi_Minh',
      hour: '2-digit', 
      minute: '2-digit', 
      hour12: false,
      weekday: 'long'
    });
    const parts = formatter.formatToParts(now);
    
    let hour = 0, minute = 0, weekday = '';
    parts.forEach(p => {
      if (p.type === 'hour') hour = parseInt(p.value);
      if (p.type === 'minute') minute = parseInt(p.value);
      if (p.type === 'weekday') weekday = p.value;
    });
    
    const dayMap = { 
      'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 
      'Thursday': 4, 'Friday': 5, 'Saturday': 6 
    };
    
    return { hour, minute, dayOfWeek: dayMap[weekday] ?? now.getDay(), dayName: weekday };
  } catch (error) {
    console.error('Timezone error:', error);
    const now = new Date();
    return { hour: now.getHours(), minute: now.getMinutes(), dayOfWeek: now.getDay(), dayName: 'Unknown' };
  }
}

/**
 * Send FCM DATA-ONLY message (ensures onMessageReceived is called)
 * Channel ID MUST match Android: "medication_reminders"
 */
async function sendNotification(fcmToken, title, body, extraData = {}) {
  try {
    // DATA-ONLY message - NO notification block!
    const message = {
      token: fcmToken,
      // Chỉ dùng data payload để onMessageReceived() luôn được gọi
      data: {
        type: 'medication_reminder',
        title: title,
        body: body,
        reminder_id: extraData.reminderId || '',
        time_slot: extraData.timeSlot || '',
        snooze_duration: String(extraData.snoozeDuration || 10),
        medicine_name: extraData.medicineName || '',
        dosage: extraData.dosage || '',
        click_action: 'OPEN_REMINDER'
      },
      android: {
        priority: 'high',
        // TTL 1 hour
        ttl: 3600 * 1000
      }
    };

    const response = await messaging.send(message);
    console.log(`✅ Notification sent: ${response}`);
    return { success: true, messageId: response };
  } catch (error) {
    console.error(`❌ Send error:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Check and send reminders for all users
 */
async function checkAndSendReminders() {
  const now = new Date();
  const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  console.log(`\n⏰ Checking reminders at ${now.toISOString()} (${dayNames[now.getDay()]})`);
  
  try {
    const usersSnap = await db.collection('users').get();
    let totalChecked = 0;
    let totalSent = 0;
    
    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const fcmToken = userData.fcm_token || userData.fcmToken;
      if (!fcmToken) continue;
      
      // Query active reminders
      let remindersSnap = await db.collection('users').doc(userDoc.id)
        .collection('reminders').where('is_active', '==', true).get();
      
      if (remindersSnap.empty) {
        remindersSnap = await db.collection('users').doc(userDoc.id)
          .collection('reminders').where('isActive', '==', true).get();
      }
      
      for (const remDoc of remindersSnap.docs) {
        totalChecked++;
        const rem = remDoc.data();
        const tz = rem.timezone || 'Asia/Ho_Chi_Minh';
        const { hour, minute, dayOfWeek } = getCurrentTimeInTimezone(tz);
        
        const selectedDays = rem.selected_days || rem.selectedDays || [];
        const isEveryday = selectedDays.length === 0;
        
        if (!isEveryday && !selectedDays.includes(dayOfWeek)) continue;
        
        const slots = [
          { name: 'morning', time: rem.morning_time || rem.morningTime },
          { name: 'noon', time: rem.noon_time || rem.noonTime },
          { name: 'afternoon', time: rem.afternoon_time || rem.afternoonTime },
          { name: 'evening', time: rem.evening_time || rem.eveningTime }
        ];
        
        for (const slot of slots) {
          if (!slot.time) continue;
          
          const [slotHour, slotMinute] = slot.time.split(':').map(Number);
          
          if (slotHour === hour && slotMinute === minute) {
            console.log(`📍 Match: User ${userDoc.id}, Slot ${slot.name}, Time ${slot.time}`);
            
            const lang = userData.language === 'en' ? 'en' : 'vi';
            const t = translations[lang];
            const slotName = t.slots[slot.name];
            
            const title = t.title(slotName);
            const isDetailed = rem.is_detailed_reminder || rem.isDetailedReminder;
            const medicineName = rem.medicine_name || rem.medicineName;
            const dosage = rem.dosage;
            
            const body = isDetailed && medicineName
              ? t.detailed(medicineName, dosage)
              : t.general(slotName);
            
            const result = await sendNotification(fcmToken, title, body, {
              reminderId: remDoc.id,
              timeSlot: slot.name,
              snoozeDuration: rem.snooze_duration || rem.snoozeDuration || 10,
              medicineName: medicineName || '',
              dosage: dosage || ''
            });
            
            if (result.success) totalSent++;
          }
        }
      }
    }
    
    console.log(`📊 Checked ${totalChecked} active reminders, sent ${totalSent} notifications`);
  } catch (error) {
    console.error('❌ Cron error:', error);
  }
}

// Schedule cron job
cron.schedule('* * * * *', () => {
  checkAndSendReminders();
});

// ===== API Endpoints =====
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'SafeMed Notification Server',
    timestamp: new Date().toISOString()
  });
});

app.post('/trigger', async (req, res) => {
  console.log('🔧 Manual trigger');
  await checkAndSendReminders();
  res.json({ message: 'Reminder check triggered' });
});

app.get('/debug', async (req, res) => {
  try {
    const usersSnap = await db.collection('users').get();
    const debugInfo = [];
    
    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const userInfo = {
        userId: userDoc.id,
        fcm_token: (userData.fcm_token || userData.fcmToken) ? 'EXISTS' : 'MISSING',
        language: userData.language || 'vi',
        reminders: []
      };
      
      const remindersSnap = await db.collection('users').doc(userDoc.id)
        .collection('reminders').get();
      
      remindersSnap.forEach(remDoc => {
        userInfo.reminders.push({ id: remDoc.id, ...remDoc.data() });
      });
      
      debugInfo.push(userInfo);
    }
    
    res.json({ totalUsers: usersSnap.size, users: debugInfo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/debug-time', (req, res) => {
  const timezone = req.query.tz || 'Asia/Bangkok';
  const { hour, minute, dayOfWeek, dayName } = getCurrentTimeInTimezone(timezone);
  
  res.json({
    serverUTC: new Date().toISOString(),
    timezone,
    localTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    dayOfWeek,
    dayName
  });
});

app.post('/force-send', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
    
    const userData = userDoc.data();
    const fcmToken = userData.fcm_token || userData.fcmToken;
    if (!fcmToken) return res.status(400).json({ error: 'No FCM token' });
    
    const lang = userData.language === 'en' ? 'en' : 'vi';
    const t = translations[lang];
    
    const result = await sendNotification(
      fcmToken,
      t.title(t.slots.evening),
      t.general(t.slots.evening),
      { reminderId: 'test', timeSlot: 'evening', snoozeDuration: 10 }
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/test', async (req, res) => {
  const { fcmToken, userId, language = 'vi' } = req.body;
  
  let token = fcmToken;
  if (!token && userId) {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      token = userData.fcm_token || userData.fcmToken;
    }
  }
  
  if (!token) return res.status(400).json({ error: 'fcmToken or userId required' });
  
  const result = await sendNotification(token, '💊 Test', 'Server hoạt động bình thường!', {
    reminderId: 'test',
    timeSlot: 'test'
  });
  res.json(result);
});

app.post('/send', async (req, res) => {
  const { userId, title, body } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
    
    const userData = userDoc.data();
    const fcmToken = userData.fcm_token || userData.fcmToken;
    if (!fcmToken) return res.status(400).json({ error: 'No FCM token' });
    
    const result = await sendNotification(
      fcmToken,
      title || '💊 SafeMed',
      body || 'Notification from SafeMed'
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║   🏥 SafeMed Notification Server           ║
║   🚀 Running at http://localhost:${PORT}      ║
║   ⏰ Cron job: Every minute                ║
║   📱 Using DATA-ONLY FCM messages          ║
╚════════════════════════════════════════════╝
  `);
});