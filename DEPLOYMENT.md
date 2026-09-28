# Railway Deployment Guide

## Prerequisites
- Railway account (free tier available)
- GitHub repository with your code
- Supabase project

## Deployment Steps

### 1. Push Code to GitHub
```bash
git add .
git commit -m "Add Railway deployment configuration"
git push origin main
```

### 2. Create Railway Project
1. Go to [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Railway will automatically detect the Node.js project

### 3. Configure Web Service
1. Railway will create a web service automatically
2. Set environment variables:
   - `PORT`: 3000
   - `NODE_ENV`: production
   - `JWT_SECRET`: (generate secure random string)
   - `SUPABASE_URL`: your Supabase project URL
   - `SUPABASE_KEY`: your Supabase anon key
   - `SUPABASE_SERVICE_ROLE_KEY`: your Supabase service role key
   - `WHATSAPP_BOT_TOKEN`: (generate secure random string)
   - `ADMIN_PHONE_NUMBER`: 256748632752
   - `MTN_MONEY_NUMBER`: 0771234567
   - `MTN_MONEY_NAME`: Jefram Stores
   - `AIRTEL_MONEY_NUMBER`: 0752345678
   - `AIRTEL_MONEY_NAME`: Jefram Stores
   - `STORE_URL`: (your Railway app URL)
   - `API_URL`: (your Railway app URL)

### 4. Create Worker Service for Bot
1. In Railway project, click "New Service"
2. Select "GitHub Repo" → same repository
3. In service settings, change "Start Command" to: `npm run bot`
4. Set same environment variables as web service
5. Add: `PUPPETEER_EXECUTABLE_PATH`: `/usr/bin/chromium-browser`

### 5. Important: Persistent Storage for WhatsApp Session
1. For the worker service, add a volume:
   - Path: `.wwebjs_auth`
   - Size: 1GB
2. This ensures WhatsApp session persists across restarts

### 6. Deploy
1. Click "Deploy" on both services
2. Wait for deployment to complete
3. Once deployed, Railway will provide URLs for both services

### 7. Connect Bot to WhatsApp
1. The bot will show a QR code in the logs
2. Scan the QR code with your WhatsApp
3. Bot will authenticate and start running

### 8. Update Environment Variables
After deployment, update `STORE_URL` and `API_URL` with the actual Railway URLs provided.

## Troubleshooting

### Bot Authentication Issues
- If bot loses auth, delete the `.wwebjs_auth` volume and restart
- Re-scan QR code to re-authenticate

### Memory Issues
- Upgrade to paid tier if you encounter memory limits
- Railway free tier has 512MB RAM (may be insufficient for heavy bot usage)

### Chrome/Puppeteer Issues
- Ensure `PUPPETEER_EXECUTABLE_PATH` is set correctly
- If issues persist, the bot may need more resources

## Monitoring
- Check Railway logs for both services
- Monitor uptime and resource usage
- Set up alerts for service failures