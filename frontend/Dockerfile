# Use the official Node.js 18 image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of your frontend code
COPY . .

# Expose the React development port
EXPOSE 3000

# Start the React app
CMD ["npm", "start"]