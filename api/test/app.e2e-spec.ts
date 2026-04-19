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
      })
      .expect(201);

    expect(response.body).toEqual({
      token: expect.any(String),
      user: {
        id: expect.any(String),
        email: 'alice@example.com',
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
        createdAt: expect.any(String),
      },
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

  afterEach(async () => {
    await app.close();
  });
});
