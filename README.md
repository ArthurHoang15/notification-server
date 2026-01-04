# SafeMed Notification Server

Server Node.js để gửi FCM push notifications cho ứng dụng SafeMed. Thay thế Firebase Cloud Functions (yêu cầu Blaze plan).

## 🚀 Tính năng

- ✅ Kiểm tra reminders mỗi phút
- ✅ Gửi FCM notifications đúng giờ
- ✅ Hỗ trợ đa ngôn ngữ (Tiếng Việt, English)
- ✅ Hỗ trợ 4 khung giờ (sáng, trưa, chiều, tối)
- ✅ API endpoints để test và debug

## 📋 Yêu cầu

- Node.js >= 18.0.0
- Firebase project với Firestore
- Service Account key từ Firebase

## 🛠️ Cài đặt Local

### 1. Cài đặt dependencies

```bash
cd notification-server
npm install
```

### 2. Lấy Service Account

1. Vào [Firebase Console](https://console.firebase.google.com)
2. Chọn project `safemed-3205d`
3. Vào **Project Settings** > **Service Accounts**
4. Click **Generate new private key**
5. Lưu file JSON vào `notification-server/service-account.json`

### 3. Chạy server

```bash
npm start
```

Server sẽ chạy tại `http://localhost:3000`

## 🌐 Deploy lên Railway (Miễn phí)

### 1. Tạo tài khoản Railway

1. Vào [railway.app](https://railway.app)
2. Đăng nhập bằng GitHub

### 2. Tạo project mới

1. Click **New Project**
2. Chọn **Deploy from GitHub repo**
3. Chọn repo SafeMeds
4. Chọn thư mục `notification-server`

### 3. Cấu hình Environment Variables

Vào **Variables** và thêm:

```
FIREBASE_SERVICE_ACCOUNT=<nội dung file service-account.json>
```

**Lưu ý:** Paste toàn bộ nội dung JSON (minified) của file service-account.json

### 4. Deploy

Railway sẽ tự động build và deploy. Server sẽ chạy 24/7.

## 📡 API Endpoints

### Health Check
```
GET /
```
Response:
```json
{
  "status": "ok",
  "message": "SafeMed Notification Server is running",
  "timestamp": "2026-01-04T10:00:00.000Z"
}
```

### Trigger Manual Check
```
POST /trigger
```
Kích hoạt kiểm tra reminders thủ công.

### Test Notification
```
POST /test
Content-Type: application/json

{
  "fcmToken": "your-fcm-token",
  "language": "vi"
}
```

### Send to User
```
POST /send
Content-Type: application/json

{
  "userId": "user-id",
  "title": "Custom Title",
  "body": "Custom message"
}
```

## 🔧 Cấu trúc thư mục

```
notification-server/
├── package.json        # Dependencies
├── server.js           # Main server code
├── .env.example        # Environment template
├── .gitignore          # Git ignore rules
├── README.md           # Documentation
└── service-account.json # Firebase key (không commit!)
```

## ⚠️ Lưu ý quan trọng

1. **KHÔNG BAO GIỜ** commit file `service-account.json` lên GitHub
2. Server cần chạy 24/7 để gửi notifications đúng giờ
3. Railway free tier có giới hạn 500 giờ/tháng, đủ dùng nếu chỉ 1 project
4. AlarmManager trong app vẫn là phương pháp chính, server này là backup cho trường hợp app bị kill

## 🐛 Debug

Xem logs:
- Local: Terminal output
- Railway: Dashboard > Deployments > View Logs

## 📞 Liên hệ

SafeMed Team - UEH University
