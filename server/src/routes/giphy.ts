import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { requireAuth } from '../auth/middleware.js';

export default async function giphyRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string } }>(
    '/api/giphy/search',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!config.giphyApiKey) {
        return reply.code(503).send({ error: 'GIF search not configured' });
      }

      const { q } = request.query;
      const endpoint = q?.trim()
        ? `https://api.giphy.com/v1/gifs/search?api_key=${config.giphyApiKey}&q=${encodeURIComponent(q)}&limit=10&rating=g`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${config.giphyApiKey}&limit=10&rating=g`;

      const res = await fetch(endpoint);
      const data = await res.json();
      return data;
    },
  );
}
