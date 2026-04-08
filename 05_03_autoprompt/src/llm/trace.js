let traces = [];

export const recordTrace = ({ stage, request, response, durationMs }) => {
  traces.push({
    timestamp: new Date().toISOString(),
    stage,
    request,
    response,
    durationMs,
  });
};

export const collectTraces = () => {
  const collected = traces;
  traces = [];
  return collected;
};
