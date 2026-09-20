import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/react'

export function AuthControls() {
  return <div className="auth-controls">
    <Show when="signed-out">
      <SignInButton mode="modal"><button className="secondary-button">Sign in</button></SignInButton>
      <SignUpButton mode="modal"><button className="log-button">Create account</button></SignUpButton>
    </Show>
    <Show when="signed-in"><UserButton /></Show>
  </div>
}
