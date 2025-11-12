#!/usr/bin/env node

/**
 * Generate VAPID keys for Push Notifications
 * Run: node generate-vapid-keys.js
 */

const webpush = require('web-push');

console.log('\n🔐 Generating VAPID Keys for Push Notifications...\n');

const vapidKeys = webpush.generateVAPIDKeys();

console.log('=======================================');
console.log('✅ VAPID Keys Generated Successfully!');
console.log('=======================================\n');

console.log('📋 Add these to your server/.env file:\n');

console.log('VAPID_PUBLIC_KEY=' + vapidKeys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + vapidKeys.privateKey);
console.log('VAPID_SUBJECT=mailto:your-email@derplanner.space');

console.log('\n=======================================');
console.log('⚠️  IMPORTANT SECURITY NOTES:');
console.log('=======================================');
console.log('1. Keep the PRIVATE key secret!');
console.log('2. Never commit .env to git');
console.log('3. The PUBLIC key is safe to expose');
console.log('4. Change VAPID_SUBJECT to your email/URL');
console.log('=======================================\n');

console.log('📝 Next Steps:');
console.log('1. Copy the keys above to server/.env');
console.log('2. Restart your server');
console.log('3. Push notifications will be enabled!');
console.log('\n✅ Done!\n');



