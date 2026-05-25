// PM2 Configuration for Antigravity Verification Bot
// 
// Install PM2: npm install -g pm2
// Start bot: pm2 start ecosystem.config.js
// Monitor: pm2 monit
// Logs: pm2 logs agverif-bot
// Restart: pm2 restart agverif-bot
// Stop: pm2 stop agverif-bot

module.exports = {
	apps: [
		{
			name: 'agverif-bot',
			script: './agverif.js',
			instances: 1,
			exec_mode: 'fork',
			watch: false, // Set true for development
			max_memory_restart: '500M',
			env: {
				NODE_ENV: 'production',
			},
			error_file: './logs/err.log',
			out_file: './logs/out.log',
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
			merge_logs: true,
			autorestart: true,
			restart_delay: 4000,
			max_restarts: 10,
			min_uptime: '10s',
		},
	],
};
