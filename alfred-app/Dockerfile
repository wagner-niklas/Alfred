FROM node:22

WORKDIR /app

# Install dependencies (production only)
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the app source
COPY . .

# Build the Next.js app
RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000

# Start the production server
CMD ["npm", "start"]