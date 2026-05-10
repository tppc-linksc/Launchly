package com.launchly.release.repositories;

import com.launchly.release.entities.GateExemption;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface GateExemptionRepository extends JpaRepository<GateExemption, String> {
    List<GateExemption> findByReleaseId(String releaseId);
}
