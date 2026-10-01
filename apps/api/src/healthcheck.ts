try {
  const response = await fetch('http://127.0.0.1:3001/health');
  if (!response.ok) {
    console.error(`Healthcheck failed with HTTP ${response.status}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error('Healthcheck request failed', error);
  process.exitCode = 1;
}
