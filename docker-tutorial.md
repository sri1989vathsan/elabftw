# Docker Tutorial: From Zero to Working Knowledge

## 1. What Docker Actually Is

Normally, an app that works on your laptop might break on someone else's computer, because they're missing a library, or have a different version of something. Docker fixes this by packing the app and everything it needs into one box that runs the same way everywhere.

A few words you'll see everywhere:

- **Image**: the packed box itself. It's just a file sitting on disk, not running yet. Think of it like a recipe.
- **Container**: an image that's actually running. Think of it like the meal you cooked from the recipe. You can make many containers from one image.
- **Dockerfile**: a plain text file with step-by-step instructions for building an image.
- **Registry**: an online storage shelf for images. Docker Hub is the most common one, and it's free to pull public images from.

You might wonder how this differs from a virtual machine. A VM copies an entire computer, operating system included, which is heavy and slow to start. A container skips that — it reuses your computer's existing operating system and only wraps up the app itself. That's why containers start in about a second instead of a minute.

## 2. Installing Docker

- **Mac or Windows**: download Docker Desktop from docker.com and install it like any other app. This gives you everything you need.
- **Linux**: install it through your package manager, e.g. `apt-get install docker.io` on Ubuntu.

Once it's installed, check it works:

```bash
docker --version
docker run hello-world
```

If you see a friendly welcome message, you're set up correctly.

## 3. Running Your First Containers

First, download an image from Docker Hub:

```bash
docker pull nginx
```

Now run it:

```bash
docker run nginx
```

That starts a container, but it takes over your terminal. In practice you'll usually add a few options:

```bash
docker run -d nginx
```
`-d` means "detached" — it runs quietly in the background and gives you your terminal back.

```bash
docker run -p 8080:80 nginx
```
`-p` connects a port on your computer to a port inside the container. Here, visiting `localhost:8080` reaches the container's port 80.

```bash
docker run --name myweb -d -p 8080:80 nginx
```
`--name` just gives the container a nickname, so you don't have to refer to it by a random ID.

```bash
docker run -it ubuntu bash
```
`-it` opens an interactive session, dropping you straight into a shell inside the container — handy for poking around.

Once containers exist, here's how to manage them:

```bash
docker ps                  # what's running right now
docker ps -a               # everything, including stopped containers
docker stop myweb          # stop it
docker start myweb         # start it again
docker rm myweb            # delete it (must be stopped first)
docker logs myweb          # see what it's printed
docker exec -it myweb bash # hop into a shell inside a running container
```

And for the images themselves:

```bash
docker images         # what images you have downloaded
docker rmi nginx      # delete an image
docker system prune   # clean up leftover clutter
```

## 4. Writing Your Own Dockerfile

A Dockerfile is the recipe for building your own image. Here's a simple one for a Node.js app:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
```

Line by line, in plain terms:

- `FROM` — start from an existing image instead of building from nothing. Here, a small image that already has Node.js installed.
- `WORKDIR` — set the folder inside the container where the next steps happen.
- `COPY` — copy files from your computer into the image.
- `RUN` — run a command while building the image, like installing dependencies.
- `EXPOSE` — a note-to-self saying which port the app uses (it doesn't actually open anything).
- `CMD` — the command that runs when someone starts a container from this image.

Build the image, then run it:

```bash
docker build -t myapp .
docker run -p 3000:3000 myapp
```

`-t myapp` just names your image "myapp." The `.` tells Docker to look for the Dockerfile in the folder you're standing in.

## 5. Saving Data with Volumes

Here's a gotcha: if you delete a container, any files it created disappear with it. Volumes solve this by storing data outside the container, so it survives.

```bash
docker volume create mydata
docker run -v mydata:/app/data myapp
```

While developing locally, it's common to link a folder on your own computer straight into the container, so your code changes show up instantly:

```bash
docker run -v $(pwd):/app myapp
```

## 6. Letting Containers Talk to Each Other

If you want two containers to talk to each other (say, an app and a database), put them on the same network. Then they can reach each other just by name, like a phone contact list.

```bash
docker network create mynet
docker run --network mynet --name db -d postgres
docker run --network mynet --name app -d myapp
```

Now the `app` container can reach the database simply by connecting to `db`, instead of needing to know its IP address.

## 7. Running Everything Together with Docker Compose

Real apps are usually more than one container — an app plus a database, say. Instead of typing out long `docker run` commands for each one, Compose lets you describe the whole setup in a single file.

`docker-compose.yml`:

```yaml
version: "3.9"
services:
  app:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      - db
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: example
    volumes:
      - dbdata:/var/lib/postgresql/data

volumes:
  dbdata:
```

Then it's just:

```bash
docker compose up -d       # build and start everything, in the background
docker compose ps          # check what's running
docker compose logs -f app # watch one service's logs live
docker compose down        # stop and remove everything
```

## 8. A Few Habits Worth Building Early

- Use small base images (like `alpine` versions) so your images build and download faster.
- Don't run containers as the root user in production — it's an unnecessary security risk.
- Add a `.dockerignore` file to skip copying things like `node_modules` into your image, the same way `.gitignore` skips files in git.
- Name your image versions clearly (`myapp:1.2.0`) instead of always using the default `latest`.
- Keep settings that change between environments (like passwords or URLs) as environment variables, not hardcoded into the image.

## 9. What to Try Next

1. Pick a small project of yours and write a Dockerfile for it, using the Node.js example as a template.
2. Add a database alongside it using Docker Compose.
3. Push your image to Docker Hub with `docker tag` and `docker push`, just to see the full round trip.
4. Once that all feels comfortable, look into multi-stage builds, which trim images down further.
