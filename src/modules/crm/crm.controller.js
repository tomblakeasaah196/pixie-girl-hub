/**
 * CRM (V2.2 §6.1) — HTTP controllers.
 */

"use strict";

const service = require("./crm.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// Pipelines + stages
const listPipelines = async (req, res) =>
  res.json({ data: await service.listPipelines({ brand: req.brand }) });
const createPipeline = async (req, res) =>
  res.status(201).json({
    data: await service.createPipeline({ ...base(req), input: req.body }),
  });
const updatePipeline = async (req, res) =>
  res.json({
    data: await service.updatePipeline({
      ...base(req),
      id: req.params.pipeId,
      patch: req.body,
    }),
  });
const archivePipeline = async (req, res) => {
  await service.archivePipeline({ ...base(req), id: req.params.pipeId });
  res.status(204).end();
};
const listStages = async (req, res) =>
  res.json({
    data: await service.listStages({
      brand: req.brand,
      pipeline_id: req.params.pipeId,
    }),
  });
const createStage = async (req, res) =>
  res.status(201).json({
    data: await service.createStage({
      ...base(req),
      pipeline_id: req.params.pipeId,
      input: req.body,
    }),
  });
const updateStage = async (req, res) =>
  res.json({
    data: await service.updateStage({
      ...base(req),
      stage_id: req.params.stageId,
      patch: req.body,
    }),
  });
const deleteStage = async (req, res) => {
  await service.deleteStage({ ...base(req), stage_id: req.params.stageId });
  res.status(204).end();
};

// Deals
async function listDeals(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listDeals({
      brand: req.brand,
      scope: req.permission_scope,
      user: req.user,
      filters: {
        pipeline_id: req.query.pipeline_id,
        current_stage_id: req.query.stage_id,
        status: req.query.status,
        contact_id: req.query.contact_id,
        assigned_to: req.query.assigned_to,
        q: req.query.q,
      },
      page,
      page_size,
    }),
  );
}
const getDeal = async (req, res) =>
  res.json({
    data: await service.getDeal({
      brand: req.brand,
      scope: req.permission_scope,
      user: req.user,
      id: req.params.id,
    }),
  });
const createDeal = async (req, res) =>
  res.status(201).json({
    data: await service.createDeal({ ...base(req), input: req.body }),
  });
const updateDeal = async (req, res) =>
  res.json({
    data: await service.updateDeal({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
const moveStage = async (req, res) =>
  res.json({
    data: await service.moveStage({
      ...base(req),
      id: req.params.id,
      stage_id: req.body.stage_id,
    }),
  });
const setStatus = async (req, res) =>
  res.json({
    data: await service.setStatus({
      ...base(req),
      id: req.params.id,
      status: req.body.status,
      lost_reason: req.body.lost_reason,
    }),
  });
const deleteDeal = async (req, res) => {
  await service.deleteDeal({ ...base(req), id: req.params.id });
  res.status(204).end();
};

// Activities + notes
const listActivities = async (req, res) =>
  res.json({
    data: await service.listActivities({ brand: req.brand, id: req.params.id }),
  });
const addActivity = async (req, res) =>
  res.status(201).json({
    data: await service.addActivity({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const listNotes = async (req, res) =>
  res.json({
    data: await service.listNotes({ brand: req.brand, id: req.params.id }),
  });
const addNote = async (req, res) =>
  res.status(201).json({
    data: await service.addNote({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });

// Customer profile (preferences / measurements / churn) — keyed by contactId
const getPreferences = async (req, res) =>
  res.json({
    data: await service.getPreferences({
      brand: req.brand,
      contact_id: req.params.contactId,
    }),
  });
const upsertPreferences = async (req, res) =>
  res.json({
    data: await service.upsertPreferences({
      ...base(req),
      contact_id: req.params.contactId,
      patch: req.body,
    }),
  });
const listMeasurements = async (req, res) =>
  res.json({
    data: await service.listMeasurements({
      brand: req.brand,
      contact_id: req.params.contactId,
    }),
  });
const addMeasurement = async (req, res) =>
  res.status(201).json({
    data: await service.addMeasurement({
      ...base(req),
      contact_id: req.params.contactId,
      input: req.body,
    }),
  });
const updateMeasurement = async (req, res) =>
  res.json({
    data: await service.updateMeasurement({
      ...base(req),
      contact_id: req.params.contactId,
      measurement_id: req.params.measurementId,
      patch: req.body,
    }),
  });
const deleteMeasurement = async (req, res) => {
  await service.deleteMeasurement({
    ...base(req),
    contact_id: req.params.contactId,
    measurement_id: req.params.measurementId,
  });
  res.status(204).end();
};
const listChurnScores = async (req, res) =>
  res.json({
    data: await service.listChurnScores({
      brand: req.brand,
      contact_id: req.params.contactId,
    }),
  });
const recordChurnScore = async (req, res) =>
  res.status(201).json({
    data: await service.recordChurnScore({
      ...base(req),
      contact_id: req.params.contactId,
      input: req.body,
    }),
  });

const kpis = async (req, res) =>
  res.json({ data: await service.kpis({ brand: req.brand }) });

module.exports = {
  kpis,
  listPipelines,
  createPipeline,
  updatePipeline,
  archivePipeline,
  listStages,
  createStage,
  updateStage,
  deleteStage,
  listDeals,
  getDeal,
  createDeal,
  updateDeal,
  moveStage,
  setStatus,
  deleteDeal,
  listActivities,
  addActivity,
  listNotes,
  addNote,
  getPreferences,
  upsertPreferences,
  listMeasurements,
  addMeasurement,
  updateMeasurement,
  deleteMeasurement,
  listChurnScores,
  recordChurnScore,
};
