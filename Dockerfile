FROM node:14
USER root
COPY /server .
RUN npm install

CMD ["npm", "run", "start"]
EXPOSE 3005