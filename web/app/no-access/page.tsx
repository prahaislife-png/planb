export default function NoAccess() {
  return (
    <div className="notice bad" style={{ maxWidth: 640 }}>
      <h3>No access</h3>
      <p>PlanB Intelligence is restricted to research staff. Your account is not signed in or holds no staff role.</p>
      <p className="muted small">Staff roles are granted by an administrator in <code>ops.staff_roles</code>.</p>
    </div>
  );
}
