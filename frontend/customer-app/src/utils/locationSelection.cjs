'use strict';

function updateLocationDraft(current, field, location) {
  if (field !== 'pickup' && field !== 'dropoff') throw new Error('invalid location field');
  return {
    pickup: current?.pickup || null,
    dropoff: current?.dropoff || null,
    [field]: location,
  };
}

function isLatestLocationRequest(sequences, field, requestSequence) {
  return (field === 'pickup' || field === 'dropoff') && sequences?.[field] === requestSequence;
}

module.exports = { isLatestLocationRequest, updateLocationDraft };
