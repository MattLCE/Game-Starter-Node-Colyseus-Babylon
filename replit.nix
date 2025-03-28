{ pkgs }: {
  deps = [
    pkgs.nodejs_20 # Use a specific, recent LTS version like Node 20
    # Add other system dependencies here if needed later (e.g., pkgs.imagemagick)
  ];
  environment = {
    # Environment variables can be set here if needed
    # EXAMPLE_VAR = "example_value";
  };
}