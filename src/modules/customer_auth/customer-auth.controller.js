/**
 * Customer auth HTTP controller. Sets/clears the httpOnly refresh cookie and
 * returns the access token + profile in the body (the website holds the access
 * token in memory). Relies on express-async-errors for error propagation.
 */

"use strict";

const service = require("./customer-auth.service");
const { VALID_BRANDS } = require("../../config/brands");

const COOKIE = "sf_refresh";

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: "/",
  };
}

function brandHint(req) {
  const h = req.brand || req.headers["x-brand-context"] || req.query.brand;
  return VALID_BRANDS.has(h) ? h : "pixiegirl";
}

async function register(req, res) {
  const r = await service.register({
    brand: brandHint(req),
    email: req.body.email,
    password: req.body.password,
    first_name: req.body.first_name,
    last_name: req.body.last_name,
    phone: req.body.phone,
    user_agent: req.headers["user-agent"],
    ip: req.ip,
  });
  res.cookie(COOKIE, r.refresh_token, cookieOpts());
  res
    .status(201)
    .json({ data: { access_token: r.access_token, contact: r.contact } });
}

async function login(req, res) {
  const r = await service.login({
    email: req.body.email,
    password: req.body.password,
    user_agent: req.headers["user-agent"],
    ip: req.ip,
  });
  res.cookie(COOKIE, r.refresh_token, cookieOpts());
  res.json({ data: { access_token: r.access_token, contact: r.contact } });
}

async function refresh(req, res) {
  const r = await service.refresh({
    refresh_token: req.cookies ? req.cookies[COOKIE] : null,
    user_agent: req.headers["user-agent"],
    ip: req.ip,
  });
  res.cookie(COOKIE, r.refresh_token, cookieOpts());
  res.json({ data: { access_token: r.access_token } });
}

async function logout(req, res) {
  await service.logout({
    refresh_token: req.cookies ? req.cookies[COOKIE] : null,
  });
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ data: { ok: true } });
}

async function me(req, res) {
  res.json({ data: await service.me({ contact_id: req.customer.contact_id }) });
}

async function orders(req, res) {
  res.json({
    data: await service.listOrders({
      brand: brandHint(req),
      contact_id: req.customer.contact_id,
    }),
  });
}

async function verifyEmail(req, res) {
  res.json({ data: await service.verifyEmail({ token: req.body.token }) });
}

async function forgot(req, res) {
  res.json({
    data: await service.forgotPassword({
      brand: brandHint(req),
      email: req.body.email,
    }),
  });
}

async function reset(req, res) {
  res.json({
    data: await service.resetPassword({
      token: req.body.token,
      password: req.body.password,
    }),
  });
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
  orders,
  verifyEmail,
  forgot,
  reset,
};
