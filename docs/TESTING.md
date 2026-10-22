# Testing

JavaScript checks use Node 22+; Python checks need the development requirements.

```sh
python3 -m pip install -r requirements-dev.txt
python3 -m unittest discover -s tests -p 'test_*.py'
node tests/test-ui.cjs
node tests/test-pendant.cjs
node tests/test-pendant-layout.cjs
node tests/test-machine-entry.cjs
node tests/test-units.cjs
node tests/test-shared-settings.cjs
node tests/test-running-view.cjs
node tests/test-run-speed.cjs
```

Mocks test safety decisions without commanding hardware. Browser checks cover coordinate editing cancellation, metric/cm/in display, single/double tap behavior, cross-client preference synchronization, dialogs, responsive layouts, and simulated job states. APK compilation and signature verification do not replace physical Android testing.

For each new machine, verify homing and direction at low speed with tools clear, then physical limits, offsets, Safe Z lock/cap/relocking, keep-out margins, pause lift and ordered resume. Test cancellation and network loss. Do not use an unreviewed cutting program to validate the interface. Validate job-start speed policy with a motionless test file first. Never rely on the software emergency button as the only stop mechanism.
