# Deploy to Fly.io

อัพโหลดโค้ดขึ้น production server (Fly.io) ด้วยขั้นตอนนี้:

## ขั้นตอน

### 1. ตรวจสอบไฟล์ที่เปลี่ยน
```bash
git status
```

### 2. Commit ไฟล์ที่ต้องการ
```bash
git add <files...>
git commit -m "<commit message>"
```

### 3. Push ขึ้น GitHub
```bash
git push origin main
```

### 4. Deploy ขึ้น Fly.io
```bash
fly deploy
```

รอจนเห็น `✔ Machine ... is now in a good state` แล้วเปิด https://oxford-vocab-tn.fly.dev/ เพื่อตรวจสอบ

---

## หมายเหตุ

- Fly.io build Docker image จาก `Dockerfile` อัตโนมัติ
- ถ้า build ช้าเพราะ layer ใหม่ ปกติใช้เวลาไม่เกิน 2–3 นาที
- ถ้า deploy ล้มเหลว ดู log ได้ที่ https://fly.io/apps/oxford-vocab-tn/monitoring
- `dashboard-react/` ถูก build เป็น static file ใน Docker image อยู่แล้ว ไม่ต้อง build แยก
