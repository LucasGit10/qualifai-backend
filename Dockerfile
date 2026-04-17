FROM node:18-alpine

WORKDIR /app

# Add dependencies that might be needed by some npm packages like ffmpeg or python-based native modules
RUN apk add --no-cache curl python3 make g++

COPY package*.json ./

# Install ALL dependencies (including devDependencies like nodemon)
RUN npm install

# The source code will be mapped via volume in docker-compose, 
# but it's good practice to copy it for a standalone run.
COPY . .

# Expose the API port
EXPOSE 3001

# Start development server with hot-reload (nodemon)
CMD ["npm", "run", "dev"]