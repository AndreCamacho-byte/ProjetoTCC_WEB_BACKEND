import { Router } from "express";
import * as spots from "../controllers/spot.controller";
import { requireAuth } from "../middlewares/auth";
import { requireMinAge } from "../middlewares/age";
import { limits } from "../middlewares/rateLimit";

// Spots no mapa e encontros. Tudo exige login e idade mínima (12 anos), menos a foto do spot:
// a tag <img> do site não manda o token.
export const spotRoutes = Router();

const member = [requireAuth, requireMinAge];

/**
 * @openapi
 * components:
 *   schemas:
 *     SpotType:
 *       type: string
 *       enum: [STREET, PISTA, BOWL, MINI_RAMP, DIY, OUTRO]
 *     SpotStatus:
 *       type: string
 *       enum: [PENDENTE, APROVADO, RECUSADO]
 *       description: Spot sugerido só aparece no mapa depois de APROVADO por um administrador
 *     SpotPin:
 *       type: object
 *       description: Spot aprovado, do jeito que vai para o mapa
 *       properties:
 *         id: { type: string, format: uuid }
 *         name: { type: string, example: Praça Roosevelt }
 *         type: { $ref: '#/components/schemas/SpotType' }
 *         address: { type: string, nullable: true, example: 'Consolação, São Paulo' }
 *         latitude: { type: number, example: -23.5489 }
 *         longitude: { type: number, example: -46.6453 }
 *         coverUrl: { type: string, nullable: true, example: '/api/spots/images/3f2b...' }
 *         upcomingMeetups: { type: integer, example: 2 }
 *     Meetup:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         title: { type: string, example: Sessão de sábado }
 *         description: { type: string, nullable: true }
 *         startsAt: { type: string, format: date-time }
 *         maxParticipants: { type: integer, nullable: true, description: Nulo = sem limite }
 *         participantCount: { type: integer, example: 5 }
 *         full: { type: boolean }
 *         cancelled: { type: boolean }
 *         started: { type: boolean }
 *         joinedByMe: { type: boolean }
 *         isCreator: { type: boolean }
 *         canCancel: { type: boolean }
 *         spot:
 *           type: object
 *           properties:
 *             id: { type: string, format: uuid }
 *             name: { type: string }
 *             address: { type: string, nullable: true }
 *             type: { $ref: '#/components/schemas/SpotType' }
 *         creator: { $ref: '#/components/schemas/Author' }
 *     MeetupDetail:
 *       allOf:
 *         - $ref: '#/components/schemas/Meetup'
 *         - type: object
 *           properties:
 *             participants:
 *               type: array
 *               items: { $ref: '#/components/schemas/Author' }
 */

/**
 * @openapi
 * /spots/images/{imageId}:
 *   get:
 *     tags: [Spots]
 *     summary: Foto de um spot (JPEG)
 *     description: Pública, porque a tag de imagem do site não manda o token.
 *     parameters:
 *       - in: path
 *         name: imageId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: A foto
 *         content:
 *           image/jpeg: {}
 *       404: { description: Foto não encontrada }
 */
spotRoutes.get("/spots/images/:imageId", spots.getSpotImage);

/**
 * @openapi
 * /spots:
 *   get:
 *     tags: [Spots]
 *     summary: Spots aprovados, para o mapa
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de spots
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/SpotPin' }
 *       403: { description: Menor de 12 anos ou idade não verificada }
 *   post:
 *     tags: [Spots]
 *     summary: Sugere um spot
 *     description: >
 *       O spot fica PENDENTE até um administrador aprovar (spot cadastrado por administrador já entra aprovado).
 *       Até 3 fotos em JPEG (data URL base64), cada uma com até 600 KB. Limite de 10 sugestões por dia.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, type, latitude, longitude]
 *             properties:
 *               name: { type: string, maxLength: 60, example: Praça Roosevelt }
 *               description: { type: string, maxLength: 500, nullable: true }
 *               type: { $ref: '#/components/schemas/SpotType' }
 *               address: { type: string, maxLength: 120, nullable: true, example: 'Consolação, São Paulo' }
 *               latitude: { type: number, example: -23.5489 }
 *               longitude: { type: number, example: -46.6453 }
 *               images:
 *                 type: array
 *                 maxItems: 3
 *                 items: { type: string, example: 'data:image/jpeg;base64,...' }
 *     responses:
 *       201:
 *         description: Sugestão recebida
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string, format: uuid }
 *                 status: { $ref: '#/components/schemas/SpotStatus' }
 *       400: { description: Dados inválidos }
 *       429: { description: Muitas sugestões no mesmo dia }
 */
spotRoutes.get("/spots", ...member, spots.listSpots);
spotRoutes.post("/spots", ...member, limits.spotCreation, spots.createSpot);

/**
 * @openapi
 * /spots/mine:
 *   get:
 *     tags: [Spots]
 *     summary: Spots que você sugeriu, com a situação de cada um
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Suas sugestões
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string, format: uuid }
 *                   name: { type: string }
 *                   type: { $ref: '#/components/schemas/SpotType' }
 *                   address: { type: string, nullable: true }
 *                   status: { $ref: '#/components/schemas/SpotStatus' }
 *                   coverUrl: { type: string, nullable: true }
 *                   createdAt: { type: string, format: date-time }
 */
spotRoutes.get("/spots/mine", ...member, spots.listMySpots);

/**
 * @openapi
 * /spots/{id}:
 *   get:
 *     tags: [Spots]
 *     summary: Detalhes de um spot e os próximos encontros nele
 *     description: Spot ainda não aprovado só aparece para quem sugeriu e para administradores.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: O spot
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string, format: uuid }
 *                 name: { type: string }
 *                 description: { type: string, nullable: true }
 *                 type: { $ref: '#/components/schemas/SpotType' }
 *                 address: { type: string, nullable: true }
 *                 latitude: { type: number }
 *                 longitude: { type: number }
 *                 status: { $ref: '#/components/schemas/SpotStatus' }
 *                 imageUrls: { type: array, items: { type: string } }
 *                 createdBy:
 *                   nullable: true
 *                   allOf:
 *                     - $ref: '#/components/schemas/Author'
 *                 canDelete: { type: boolean }
 *                 meetups:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Meetup' }
 *       404: { description: Spot não encontrado }
 *   delete:
 *     tags: [Spots]
 *     summary: Apaga um spot
 *     description: Quem sugeriu apaga enquanto não foi aprovado. Spot aprovado só um administrador remove.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: Spot apagado }
 *       403: { description: Spot aprovado só pode ser removido pela equipe }
 *       404: { description: Spot não encontrado }
 */
spotRoutes.get("/spots/:id", ...member, spots.getSpot);
spotRoutes.delete("/spots/:id", ...member, spots.deleteSpot);

/**
 * @openapi
 * /spots/{id}/meetups:
 *   post:
 *     tags: [Spots]
 *     summary: Marca um encontro num spot aprovado
 *     description: Quem cria já entra confirmado. A data precisa estar nos próximos 90 dias. Limite de 10 encontros por dia.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, startsAt]
 *             properties:
 *               title: { type: string, maxLength: 80, example: Sessão de sábado }
 *               description: { type: string, maxLength: 500, nullable: true }
 *               startsAt: { type: string, format: date-time }
 *               maxParticipants: { type: integer, minimum: 2, maximum: 50, nullable: true, description: Nulo = sem limite }
 *     responses:
 *       201:
 *         description: Encontro criado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Meetup' }
 *       400: { description: Dados inválidos ou data fora do prazo }
 *       404: { description: Spot não encontrado ou ainda não aprovado }
 *       429: { description: Muitos encontros no mesmo dia }
 */
spotRoutes.post("/spots/:id/meetups", ...member, limits.meetupCreation, spots.createMeetup);

/**
 * @openapi
 * /meetups:
 *   get:
 *     tags: [Spots]
 *     summary: Próximos encontros em todos os spots
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 30 }
 *     responses:
 *       200:
 *         description: Encontros em ordem de data
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Meetup' }
 */
spotRoutes.get("/meetups", ...member, spots.listUpcomingMeetups);

/**
 * @openapi
 * /meetups/mine:
 *   get:
 *     tags: [Spots]
 *     summary: Encontros em que você confirmou presença
 *     description: Inclui os que você criou e os cancelados (é assim que quem confirmou fica sabendo do cancelamento). Mostra da última semana em diante.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Seus encontros
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Meetup' }
 */
spotRoutes.get("/meetups/mine", ...member, spots.listMyMeetups);

/**
 * @openapi
 * /meetups/{id}:
 *   get:
 *     tags: [Spots]
 *     summary: Detalhes de um encontro e quem confirmou presença
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: O encontro
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/MeetupDetail' }
 *       404: { description: Encontro não encontrado }
 */
spotRoutes.get("/meetups/:id", ...member, spots.getMeetup);

/**
 * @openapi
 * /meetups/{id}/join:
 *   post:
 *     tags: [Spots]
 *     summary: Confirma presença
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Presença confirmada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/MeetupDetail' }
 *       404: { description: Encontro não encontrado }
 *       409: { description: 'Encontro lotado (MEETUP_FULL), cancelado (MEETUP_CANCELLED) ou que já começou (MEETUP_STARTED)' }
 *   delete:
 *     tags: [Spots]
 *     summary: Desiste de ir
 *     description: Quem criou não pode desistir; precisa cancelar o encontro.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Presença retirada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/MeetupDetail' }
 *       400: { description: Quem criou não pode desistir }
 */
spotRoutes.post("/meetups/:id/join", ...member, spots.joinMeetup);
spotRoutes.delete("/meetups/:id/join", ...member, spots.leaveMeetup);

/**
 * @openapi
 * /meetups/{id}/cancel:
 *   post:
 *     tags: [Spots]
 *     summary: Cancela um encontro
 *     description: Quem criou ou um administrador, até a hora do encontro. Quem confirmou continua vendo o encontro como cancelado.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Encontro cancelado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/MeetupDetail' }
 *       403: { description: Só quem criou pode cancelar }
 *       409: { description: Já cancelado ou já começou }
 */
spotRoutes.post("/meetups/:id/cancel", ...member, spots.cancelMeetup);
