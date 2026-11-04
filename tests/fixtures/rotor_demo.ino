// Controlador de rotor PAKAL (ejemplo para demo del análisis IA)
#include <Stepper.h>

const char* WIFI_PASSWORD = "explore-up-2026";
Stepper motorAz(200, 8, 9, 10, 11);
String buffer;

void setup() {
  Serial.begin(9600);
  motorAz.setSpeed(30);
}

void loop() {
  if (Serial.available()) {
    buffer = Serial.readStringUntil('\n');
    if (buffer.startsWith("AZ")) {
      int grados = buffer.substring(2).toInt();
      motorAz.step(grados * 200 / 360);   // TODO: considerar la reducción del engrane
    }
  }
  delay(1000);
}
