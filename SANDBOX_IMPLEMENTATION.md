# 🔒 Enhanced Sandbox Implementation Guide

## Overview

This implementation provides **complete user isolation** with support for Python, PHP, and Node.js execution, subdomain-based routing, and secure terminal access.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│         SERVER HUB V5+ (Frontend)                   │
├─────────────────────────────────────────────────────┤
│                   NGINX (Port 80)                   │
│  *.server.app → Routes to user sandboxes            │
├─────────────────────────────────────────────────────┤
│            Backend API (Port 3001)                  │
│  - UserIsolationService                             │
│  - SubdomainRoutingService                          │
│  - Terminal WebSocket Manager                       │
├─────────────────────────────────────────────────────┤
│         User Sandboxes (/home/users/{userId})       │
│  ┌────────┬────────┬────────┐                       │
│  │ Python │ Node   │  PHP   │  (per-user)          │
│  └────────┴────────┴────────┘                       │
│  - sandbox_runner.py enforces isolation            │
│  - sys.addaudithook prevents escapes                │
│  - Path validation prevents traversal               │
└─────────────────────────────────────────────────────┘
```

## File Structure

```
SERVER-HUB/
├── sandbox/
│   └── sandbox_runner.py          # Enhanced sandbox executor
├── backend/src/
│   ├── services/
│   │   ├── UserIsolationService.ts    # User sandbox management
│   │   └── SubdomainRoutingService.ts # Domain routing
│   └── api/routes/
│       └── sandbox.ts                 # Sandbox API endpoints
├── scripts/
│   └── enhanced-terminal.sh        # Setup script
├── nginx-subdomains.conf           # Nginx routing config
├── docker-compose.enhanced.yml     # Docker setup
└── SANDBOX_IMPLEMENTATION.md       # This file
```

## Key Features

### 1. Complete User Isolation

Each user gets a dedicated directory:
```
/home/users/{userId}/
├── tmp/           # User's temporary files
├── data/          # User's persistent data
├── code/          # User's code files
└── .config/       # User's configuration
```

**Users cannot access:**
- Other users' directories
- System files (except standard libraries)
- Root directories
- Parent directories

### 2. Sandbox Runner (`sandbox_runner.py`)

**Security mechanisms:**

```python
# 1. sys.addaudithook - Cannot be removed
sys.addaudithook(security_audit_hook)

# 2. builtins.open override - File access control
_builtins.open = safe_open

# 3. os module restrictions
os.listdir = safe_listdir
os.walk = safe_walk

# 4. Path validation
if not is_path_allowed(path):
    raise PermissionError("Access denied")
```

**Usage:**
```bash
python3 sandbox_runner.py user123 /home/users/user123/script.py 5001 python
```

### 3. Multi-Language Support

#### Python Execution
```bash
sandbox-runner user123 script.py 5001 python
```

#### Node.js Execution
```bash
cd /home/users/user123
node script.js
```

#### PHP Execution
```bash
php -S localhost:5001 -t /home/users/user123/code
```

### 4. Subdomain Routing

**Format:** `{userId}.server.app`

Example:
- User ID: `john-doe-abc123`
- Subdomain: `john-do.server.app`
- Port: `5000` (auto-allocated)
- Local URL: `http://localhost:5000`
- Public URL: `http://john-do.server.app`

**Nginx Configuration:**
```nginx
server_name ~^(?<user>[a-z0-9\-]+)\.server\.app$;
proxy_pass http://127.0.0.1:$user_port;
```

### 5. Port Management

```typescript
// Allocate port from pool
const port = userIsolationService.allocatePort();
// Returns: 5000, 5001, 5002, etc.

// Release when user deleted
userIsolationService.releasePort(port);
```

**Port Range:** 5000-5099 (100 concurrent users max)

## API Endpoints

### Create Sandbox
```http
POST /api/sandbox/create
Content-Type: application/json

{
  "userId": "john-doe-abc123",
  "language": "python"
}

Response:
{
  "success": true,
  "sandbox": {
    "userId": "john-doe-abc123",
    "homeDir": "/home/users/john-doe-abc123",
    "port": 5000,
    "subdomain": "john-do.server.app",
    "language": "python"
  },
  "localUrl": "http://localhost:5000",
  "publicUrl": "http://john-do.server.app"
}
```

### Execute Code
```http
POST /api/sandbox/execute
Content-Type: application/json

{
  "userId": "john-doe-abc123",
  "code": "print('Hello, World!')",
  "language": "python"
}

Response:
{
  "success": true,
  "stdout": "Hello, World!",
  "stderr": "",
  "exitCode": 0
}
```

### Get Sandbox Info
```http
GET /api/sandbox/john-doe-abc123/info

Response:
{
  "sandbox": { ... },
  "subdomain": { ... },
  "localUrl": "http://localhost:5000",
  "publicUrl": "http://john-do.server.app"
}
```

### List Files
```http
GET /api/sandbox/john-doe-abc123/files?dir=code

Response:
{
  "files": [
    { "name": "app.py", "isDirectory": false },
    { "name": "utils", "isDirectory": true }
  ]
}
```

### Read File
```http
GET /api/sandbox/john-doe-abc123/files/code/app.py

Response: (file content)
```

### Write File
```http
POST /api/sandbox/john-doe-abc123/files/code/app.py
Content-Type: application/json

{
  "content": "print('Updated code')"
}

Response:
{
  "success": true
}
```

## Setup Instructions

### 1. Install Required Packages

```bash
# Run setup script
chmod +x scripts/enhanced-terminal.sh
sudo scripts/enhanced-terminal.sh
```

This installs:
- Python 3 + pip
- Node.js 20.x
- PHP CLI
- Build tools
- Nginx
- ZSH + plugins

### 2. Docker Setup (Recommended)

```bash
docker-compose -f docker-compose.enhanced.yml up -d
```

### 3. Manual Setup

```bash
# Create sandbox directory
sudo mkdir -p /home/users
sudo chmod 755 /home/users

# Install sandbox runner
sudo cp sandbox/sandbox_runner.py /usr/local/bin/sandbox-runner
sudo chmod +x /usr/local/bin/sandbox-runner

# Install Nginx
sudo apt-get install -y nginx
sudo cp nginx-subdomains.conf /etc/nginx/sites-available/default
sudo systemctl restart nginx
```

## Security Considerations

### Path Traversal Prevention
```python
# ❌ BLOCKED: Path traversal
/home/users/user1/../user2/file.txt

# ✓ ALLOWED: Direct access to own directory
/home/users/user1/file.txt
```

### Audit Hook Protection
```python
# Hook cannot be removed or bypassed
sys.addaudithook(security_audit_hook)

# Even if user tries to remove it:
# - sys.__doc__ cannot be deleted
# - sys modules cannot be reloaded
# - Functions cannot be replaced
```

### Environment Isolation
```python
os.environ['HOME'] = '/home/users/user1'
os.environ['TMPDIR'] = '/home/users/user1/tmp'
os.environ['USER'] = 'user1'
os.environ['SANDBOX_USER'] = 'user1'
```

## Terminal Enhancement

The enhanced terminal provides:

1. **Multi-Tab Support** - Multiple sessions per user
2. **WebSocket Connection** - Real-time output
3. **Copy-Paste** - Clipboard integration
4. **Command History** - Per-user history
5. **Resize Support** - Dynamic terminal resizing
6. **Live Logs** - Session monitoring

## Deployment on Replit

### Step 1: Configure DNS

Point your domain to Replit:
```
*.server.app A 192.168.x.x  (your server IP)
```

### Step 2: Run Setup Script

```bash
bash scripts/enhanced-terminal.sh
```

### Step 3: Start Services

```bash
# Backend
npm run build
npm start

# Or with Docker
docker-compose -f docker-compose.enhanced.yml up
```

### Step 4: Access

- Local: `http://localhost:3001`
- Public: `http://server.app`
- User subdomain: `http://username.server.app`

## Monitoring & Logging

### Check Active Users
```bash
ls -la /home/users/
```

### View Sandbox Logs
```bash
docker logs server-hub-backend
```

### Monitor Nginx
```bash
tail -f /var/log/nginx/access.log
```

## Troubleshooting

### Issue: "Permission Denied"
**Solution:** Ensure `/home/users` has correct permissions:
```bash
sudo chmod 755 /home/users
```

### Issue: "Port already in use"
**Solution:** Check running processes:
```bash
lsof -i :5000
kill -9 <PID>
```

### Issue: Subdomain not resolving
**Solution:** Verify DNS and Nginx:
```bash
nslookup username.server.app
sudo systemctl restart nginx
```

### Issue: WebSocket connection fails
**Solution:** Ensure Nginx has WebSocket support:
```bash
grep -i upgrade /etc/nginx/sites-enabled/default
```

## Performance Optimization

1. **Connection Pooling** - Use Redis for session management
2. **Load Balancing** - Use multiple backend instances
3. **Caching** - Cache frequently accessed files
4. **Rate Limiting** - Limit API requests per user

## Future Enhancements

- [ ] Resource quotas (CPU, memory, disk)
- [ ] User session persistence
- [ ] File version control
- [ ] Collaborative editing
- [ ] Advanced logging and analytics
- [ ] Custom domain support
- [ ] SSL/TLS support
- [ ] User authentication integration

## Support

For issues or questions:
1. Check logs: `docker logs server-hub-backend`
2. Verify permissions: `ls -la /home/users/`
3. Test manually: `python3 sandbox_runner.py test /home/users/test/test.py 5000 python`
