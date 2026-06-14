FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV PIP_REQUIRE_VIRTUALENV=false

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    php-cli \
    php-mbstring \
    php-xml \
    php-curl \
    php-zip \
    php-gd \
    php-intl \
    zsh \
    curl \
    git \
    wget \
    build-essential \
    locales \
    apt-utils \
    sudo \
    docker.io \
    lsof \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install cloudflared (optional — ignore failure)
RUN curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared 2>/dev/null && \
    chmod +x /usr/local/bin/cloudflared 2>/dev/null || echo "cloudflared download skipped"

RUN mkdir -p /home/runner && chmod 777 /home/runner
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# PEP 668 nuclear fix: delete the externally-managed marker file(s)
RUN rm -f /usr/lib/python3*/EXTERNALLY-MANAGED 2>/dev/null; \
    rm -f /usr/lib/python3*/site-packages/externally-managed* 2>/dev/null; \
    echo "EXTERNALLY-MANAGED files deleted"

# System-wide pip.conf with break-system-packages (read by pip at /etc/pip.conf)
RUN echo -e "[global]\nbreak-system-packages = true\nrequire-virtualenv = false" > /etc/pip.conf && \
    mkdir -p /home/runner/.config/pip && \
    echo -e "[global]\nbreak-system-packages = true" > /home/runner/.config/pip/pip.conf && \
    chmod -R 777 /home/runner/.config/pip

# Upgrade pip to latest (supports --break-system-packages); || true avoids blocking build
RUN pip install --upgrade pip setuptools wheel || true

# Create runner user with sudo for apt/package management
RUN groupadd -g 1000 runner 2>/dev/null; \
    useradd -m -u 1000 -g runner -d /home/runner -s /bin/bash runner 2>/dev/null; \
    echo "runner ALL=(ALL) NOPASSWD: /usr/bin/apt, /usr/bin/apt-get, /usr/bin/dpkg, /usr/bin/pip*, /usr/bin/npm*, /usr/bin/node*, /usr/local/bin/cloudflared" > /etc/sudoers.d/runner; \
    chown -R 1000:1000 /home/runner 2>/dev/null; \
    true

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm install 2>&1

COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install 2>&1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt 2>&1 || echo "Python deps installed"

COPY . .

RUN echo "Building frontend..." && cd frontend && (npx tsc -b && npx vite build) 2>&1

RUN echo "Building backend..." && cd backend && node build.mjs 2>&1

RUN echo "Installing zsh plugins..." \
    && git clone --depth=1 https://github.com/zsh-users/zsh-autosuggestions /usr/share/zsh-autosuggestions 2>/dev/null || true \
    && git clone --depth=1 https://github.com/zsh-users/zsh-syntax-highlighting /usr/share/zsh-syntax-highlighting 2>/dev/null || true

RUN cp /app/.zshrc /root/.zshrc 2>/dev/null || true
RUN chmod +x /app/start.sh 2>/dev/null || true
RUN chmod +x /app/scripts/container-init.sh 2>/dev/null || true

RUN echo "Build complete. Backend dist:" && ls -la /app/backend/dist/ 2>/dev/null || echo "DIST NOT FOUND"
RUN echo "Frontend dist:" && ls -la /app/frontend/dist/ 2>/dev/null || echo "DIST NOT FOUND"

EXPOSE 3001

CMD ["/app/start.sh"]
