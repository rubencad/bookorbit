import { KomgaFallbackController } from '../komga-fallback.controller';

describe('KomgaFallbackController', () => {
  it('answers unknown Komga paths with a Spring style JSON 404', () => {
    const reply = { status: vi.fn(), send: vi.fn() };
    reply.status.mockReturnValue(reply);
    new KomgaFallbackController().notFound({ url: '/komga/api/v1/tasks?x=1' } as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ status: 404, error: 'Not Found', path: '/komga/api/v1/tasks', timestamp: expect.any(String) }),
    );
  });
});
