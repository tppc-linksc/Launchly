import { ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
import { SecurityException } from '../errors/security.exception';

interface MockResponse {
  status: vi.Mock<MockResponse, [number]>;
  json: vi.Mock<MockResponse, [unknown]>;
  statusCode?: number;
  body?: unknown;
}

function makeHost(): { host: ArgumentsHost; response: MockResponse } {
  const response: MockResponse = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockImplementation((code: number) => {
    response.statusCode = code;
    return response;
  });
  response.json.mockImplementation((body: unknown) => {
    response.body = body;
    return response;
  });

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;

  return { host, response };
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let loggerErrorSpy: vi.SpyInstance;

  beforeEach(() => {
    loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    filter = new GlobalExceptionFilter();
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  describe('HttpException', () => {
    it('uses the string response as the message when HttpException carries a string', () => {
      const { host, response } = makeHost();
      const ex = new HttpException('plain http error', HttpStatus.BAD_REQUEST);

      filter.catch(ex, host);

      expect(response.statusCode).toBe(400);
      expect(response.body).toMatchObject({
        statusCode: 400,
        message: ['plain http error'],
      });
      expect(Array.isArray((response.body as { message: unknown[] }).message)).toBe(true);
    });

    it('extracts the message field when the HttpException response is an object with a string message', () => {
      const { host, response } = makeHost();
      const ex = new HttpException(
        { message: 'invalid payload', error: 'Bad Request' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

      filter.catch(ex, host);

      expect(response.statusCode).toBe(422);
      expect(response.body).toMatchObject({
        statusCode: 422,
        message: ['invalid payload'],
      });
    });

    it('preserves array messages from HttpException responses', () => {
      const { host, response } = makeHost();
      const ex = new HttpException(
        { message: ['field a must not be empty', 'field b is invalid'], error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(ex, host);

      expect(response.statusCode).toBe(400);
      expect(response.body).toMatchObject({
        statusCode: 400,
        message: ['field a must not be empty', 'field b is invalid'],
      });
    });
  });

  describe('SecurityException', () => {
    it('maps SecurityException to 403 with the exception message', () => {
      const { host, response } = makeHost();

      filter.catch(new SecurityException('forbidden action'), host);

      expect(response.statusCode).toBe(403);
      expect(response.body).toMatchObject({
        statusCode: 403,
        message: ['forbidden action'],
      });
    });
  });

  describe('plain Error', () => {
    it('defaults to 500 without exposing the internal error message', () => {
      const { host, response } = makeHost();

      filter.catch(new Error('boom'), host);

      expect(response.statusCode).toBe(500);
      expect(response.body).toMatchObject({
        statusCode: 500,
        message: ['服务器内部错误'],
      });
      expect(JSON.stringify(response.body)).not.toContain('boom');
      expect(loggerErrorSpy).toHaveBeenCalledWith('boom', expect.any(String));
    });

    it('does not infer a public status from internal error message text', () => {
      const { host, response } = makeHost();

      filter.catch(new Error('资源不存在'), host);

      expect(response.statusCode).toBe(500);
      expect(response.body).toMatchObject({
        statusCode: 500,
        message: ['服务器内部错误'],
      });
    });
  });

  describe('response structure', () => {
    it('emits a parseable ISO timestamp on every response', () => {
      const { host, response } = makeHost();

      filter.catch(new Error('anyhow'), host);

      const body = response.body as { timestamp: unknown; statusCode: number; message: unknown[] };
      expect(typeof body.timestamp).toBe('string');
      const parsed = new Date(body.timestamp as string);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
      expect((body.timestamp as string).endsWith('Z')).toBe(true);
    });

    it('does not leak the stack trace into the response body', () => {
      const { host, response } = makeHost();
      const err = new Error('explosive failure');
      // Force a recognisable stack so we can assert it never appears in the body
      err.stack = 'STACK_SHOULD_NEVER_LEAK_TO_CLIENT';

      filter.catch(err, host);

      const body = response.body as Record<string, unknown>;
      expect(body.stack).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('STACK_SHOULD_NEVER_LEAK_TO_CLIENT');
    });

    it('still calls response.status(...).json(...) and the recorded body matches the status', () => {
      const { host, response } = makeHost();
      const ex = new HttpException('with status', HttpStatus.CONFLICT);

      filter.catch(ex, host);

      expect(response.status).toHaveBeenCalledTimes(1);
      expect(response.status).toHaveBeenCalledWith(409);
      expect(response.json).toHaveBeenCalledTimes(1);
      const passed = response.json.mock.calls[0][0] as { statusCode: number; message: unknown[]; timestamp: string };
      expect(passed.statusCode).toBe(response.statusCode);
      expect(passed.message).toEqual(['with status']);
    });
  });
});
