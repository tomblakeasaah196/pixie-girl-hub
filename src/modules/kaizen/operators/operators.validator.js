"use strict";

const { z } = require("zod");

const inviteSchema = z.object({
  email: z.string().email(),
  display_name: z.string().min(1).max(120).optional(),
});

const disableSchema = z.object({
  confirm: z.literal(true, {
    errorMap: () => ({ message: "confirm must be true" }),
  }),
});

module.exports = { inviteSchema, disableSchema };
