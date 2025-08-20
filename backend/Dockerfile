# Usar uma imagem oficial do Node.js como base
FROM node:18-slim

# Definir a pasta de trabalho dentro do contentor
WORKDIR /usr/src/app

# Atualizar os pacotes e instalar as dependências do sistema: ffmpeg e python/pip
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Instalar o yt-dlp usando pip
RUN pip3 install yt-dlp

# Copiar os ficheiros de configuração do projeto
COPY package*.json ./

# Instalar as dependências do Node.js
RUN npm install

# Copiar o resto do código da aplicação
COPY . .

# Expor a porta em que a aplicação corre
EXPOSE 3001

# Definir o comando para iniciar a aplicação
CMD ["node", "server.js"]