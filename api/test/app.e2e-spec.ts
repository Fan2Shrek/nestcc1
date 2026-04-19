import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/auth/register (POST)', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'alice@example.com',
        password: 'password123',
        username: 'Alice',
        color: '#ff6600',
      })
      .expect(201);

    expect(response.body).toEqual({
      token: expect.any(String),
      user: {
        id: expect.any(String),
        email: 'alice@example.com',
        username: 'Alice',
        color: '#ff6600',
        createdAt: expect.any(String),
      },
    });
  });

  it('/auth/login (POST)', async () => {
    await request(app.getHttpServer()).post('/auth/register').send({
      email: 'bob@example.com',
      password: 'password123',
    });

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'bob@example.com',
        password: 'password123',
      })
      .expect(201);

    expect(response.body).toEqual({
      token: expect.any(String),
      user: {
        id: expect.any(String),
        email: 'bob@example.com',
        username: 'bob',
        color: expect.stringMatching(/^#[0-9a-f]{6}$/),
        createdAt: expect.any(String),
      },
    });
  });

  it('/auth/me (PATCH)', async () => {
    const registerResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'profile@example.com',
        password: 'password123',
      })
      .expect(201);

    const token = registerResponse.body.token;

    const updateResponse = await request(app.getHttpServer())
      .patch('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        username: 'ProfileOwner',
        color: '#22aa55',
      })
      .expect(200);

    expect(updateResponse.body).toMatchObject({
      email: 'profile@example.com',
      username: 'ProfileOwner',
      color: '#22aa55',
    });
  });

  it('/auth/login invalid password (POST)', () => {
    return request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'charlie@example.com',
        password: 'password123',
      })
      .then(() =>
        request(app.getHttpServer())
          .post('/auth/login')
          .send({
            email: 'charlie@example.com',
            password: 'wrongpass',
          })
          .expect(401),
      );
  });

  it('creates room and invited user without history cannot read old messages', async () => {
    const ownerRegisterResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'owner@example.com',
        password: 'password123',
      })
      .expect(201);

    const guestRegisterResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'guest@example.com',
        password: 'password123',
      })
      .expect(201);

    const ownerToken = ownerRegisterResponse.body.token;
    const guestToken = guestRegisterResponse.body.token;

    const roomResponse = await request(app.getHttpServer())
      .post('/chat/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'General',
        invitees: [],
      })
      .expect(201);

    const roomId = roomResponse.body.id;

    await request(app.getHttpServer())
      .post(`/chat/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ content: 'Message before guest joins timeline' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/chat/rooms/${roomId}/invitations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        email: 'guest@example.com',
        canAccessHistory: false,
      })
      .expect(201);

    const guestMessagesResponse = await request(app.getHttpServer())
      .get(`/chat/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${guestToken}`)
      .expect(200);

    expect(guestMessagesResponse.body).toEqual([]);
  });

  it('invited user with history access can read old messages', async () => {
    const ownerRegisterResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'owner2@example.com',
        password: 'password123',
      })
      .expect(201);

    const guestRegisterResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'guest2@example.com',
        password: 'password123',
      })
      .expect(201);

    const ownerToken = ownerRegisterResponse.body.token;
    const guestToken = guestRegisterResponse.body.token;

    const roomResponse = await request(app.getHttpServer())
      .post('/chat/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Project',
        invitees: [],
      })
      .expect(201);

    const roomId = roomResponse.body.id;

    await request(app.getHttpServer())
      .post(`/chat/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ content: 'Kickoff message' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/chat/rooms/${roomId}/invitations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        email: 'guest2@example.com',
        canAccessHistory: true,
      })
      .expect(201);

    const guestMessagesResponse = await request(app.getHttpServer())
      .get(`/chat/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${guestToken}`)
      .expect(200);

    expect(guestMessagesResponse.body).toHaveLength(1);
    expect(guestMessagesResponse.body[0]).toMatchObject({
      content: 'Kickoff message',
      author: {
        email: 'owner2@example.com',
      },
    });
  });

  it('general room is available and supports typing indicators for multiple users', async () => {
    const firstUserResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'typing1@example.com',
        password: 'password123',
      })
      .expect(201);

    const secondUserResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'typing2@example.com',
        password: 'password123',
      })
      .expect(201);

    const firstToken = firstUserResponse.body.token;
    const secondToken = secondUserResponse.body.token;

    const firstRoomsResponse = await request(app.getHttpServer())
      .get('/chat/rooms')
      .set('Authorization', `Bearer ${firstToken}`)
      .expect(200);

    const secondRoomsResponse = await request(app.getHttpServer())
      .get('/chat/rooms')
      .set('Authorization', `Bearer ${secondToken}`)
      .expect(200);

    const firstGeneralRoom = firstRoomsResponse.body.find(
      (room: { id: string }) => room.id === 'general',
    );
    const secondGeneralRoom = secondRoomsResponse.body.find(
      (room: { id: string }) => room.id === 'general',
    );

    expect(firstGeneralRoom).toBeDefined();
    expect(secondGeneralRoom).toBeDefined();

    await request(app.getHttpServer())
      .post('/chat/rooms/general/typing')
      .set('Authorization', `Bearer ${firstToken}`)
      .send({ isTyping: true })
      .expect(201);

    const typingResponse = await request(app.getHttpServer())
      .post('/chat/rooms/general/typing')
      .set('Authorization', `Bearer ${secondToken}`)
      .send({ isTyping: true })
      .expect(201);

    expect(typingResponse.body.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: 'typing1@example.com' }),
        expect.objectContaining({ email: 'typing2@example.com' }),
      ]),
    );
  });

  it('supports emoji reactions and exposes who reacted', async () => {
    const firstUserResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'react1@example.com',
        password: 'password123',
        username: 'ReactOne',
        color: '#dd4400',
      })
      .expect(201);

    const secondUserResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'react2@example.com',
        password: 'password123',
        username: 'ReactTwo',
        color: '#0066dd',
      })
      .expect(201);

    const firstToken = firstUserResponse.body.token;
    const secondToken = secondUserResponse.body.token;

    await request(app.getHttpServer())
      .get('/chat/rooms')
      .set('Authorization', `Bearer ${firstToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/chat/rooms')
      .set('Authorization', `Bearer ${secondToken}`)
      .expect(200);

    const messageResponse = await request(app.getHttpServer())
      .post('/chat/rooms/general/messages')
      .set('Authorization', `Bearer ${firstToken}`)
      .send({ content: 'Message with reactions' })
      .expect(201);

    const messageId = messageResponse.body.id;

    const reactionResponse = await request(app.getHttpServer())
      .post(`/chat/rooms/general/messages/${messageId}/reactions`)
      .set('Authorization', `Bearer ${secondToken}`)
      .send({ emoji: '🔥' })
      .expect(201);

    expect(reactionResponse.body.reactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          emoji: '🔥',
          users: expect.arrayContaining([
            expect.objectContaining({
              email: 'react2@example.com',
              username: 'ReactTwo',
              color: '#0066dd',
            }),
          ]),
        }),
      ]),
    );
  });

  afterEach(async () => {
    await app.close();
  });
});
