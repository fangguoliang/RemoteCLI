FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --production

# Copy built files
COPY dist/ ./dist/
COPY data/ ./data/

# Set environment
ENV NODE_ENV=production
ENV PORT=3000
ENV JWT_SECRET=ccremote-jwt-secret-2026
ENV DATABASE_PATH=/app/data/ccremote.db

EXPOSE 3000

CMD ["node", "dist/index.js"]