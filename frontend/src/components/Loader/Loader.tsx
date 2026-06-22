import './Loader.css'

export default function Loader({ size = 24 }: { size?: number }) {
  return (
    <div className="circular-loader" style={{ width: size, height: size }}>
      <svg className="circular-loader-svg" viewBox="25 25 50 50">
        <circle
          className="circular-loader-path"
          cx="50"
          cy="50"
          r="20"
          fill="none"
          strokeWidth="4"
          strokeMiterlimit="10"
        />
      </svg>
    </div>
  )
}
