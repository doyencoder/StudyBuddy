import Lottie from "lottie-react";
import loadingAnimation from "../assets/loading.json";

export default function LoadingDots({ size = 60 }: { size?: number }) {
  return (
    <Lottie
      animationData={loadingAnimation}
      loop={true}
      style={{ width: size, height: size }}
    />
  );
}